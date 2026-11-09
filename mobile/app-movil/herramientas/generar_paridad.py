"""Genera los datos con los que se comprueba que el teléfono (JS + TFLite) calcula lo mismo que el servidor (Python + Keras).

Crea dos fotos sintéticas (porción completa y bandeja con la mitad comida), corre el método REAL del servidor
(ia-ml-service/app/services/analitica/vision.py) y guarda: los píxeles, el mapa que produce el modelo .tflite y los
resultados esperados. La prueba __tests__/paridad.test.js repite el cálculo en JS y compara.

Uso: python herramientas/generar_paridad.py        (necesita TensorFlow, scikit-learn, Pillow)
"""
import base64
import json
import os
import sys
import zlib

import numpy as np
import tensorflow as tf
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(AQUI, "..", "..", "..", "..", "ia-ml-service")))
os.environ.setdefault("AGENTES_DATA_DIR", os.path.join(os.environ.get("TEMP", "/tmp"), "paridad-datos"))
from app.services.analitica import vision  # noqa: E402  (el servidor de verdad)

MODELO = os.path.join(AQUI, "..", "assets", "modelos", "bandeja_mobilenetv2_b3.tflite")
SALIDA = os.path.join(AQUI, "..", "__tests__", "datos", "paridad.json")


def bandeja(comidas):
    """Bandeja vista desde arriba: mesa oscura, plato claro y trozos de comida de colores con textura."""
    rng = np.random.default_rng(3)
    img = Image.new("RGB", (448, 448), (70, 72, 80))
    d = ImageDraw.Draw(img)
    d.ellipse((40, 40, 408, 408), fill=(232, 230, 224), outline=(200, 198, 192), width=4)
    colores = {"carne": (150, 70, 40), "ensalada": (60, 140, 55), "maiz": (230, 190, 40), "tomate": (200, 50, 45)}
    for nombre, (x, y, w, h) in comidas.items():
        d.ellipse((x, y, x + w, y + h), fill=colores[nombre])
    a = np.asarray(img, dtype=np.int16)
    ruido = rng.integers(-14, 15, a.shape)
    mascara = np.any(np.abs(a - np.array([232, 230, 224])) > 40, axis=2)[..., None]       # el ruido (textura) solo en la comida
    return Image.fromarray(np.clip(a + ruido * mascara, 0, 255).astype(np.uint8))


COMPLETA = {"carne": (90, 100, 140, 110), "ensalada": (230, 110, 120, 120), "maiz": (110, 240, 130, 100), "tomate": (250, 250, 100, 90)}
MITAD = {"carne": (90, 100, 140, 110), "maiz": (110, 240, 130, 100)}                       # se comieron la ensalada y el tomate


def bytes_b64(a):
    return base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()


interp = tf.lite.Interpreter(model_path=MODELO)
interp.allocate_tensors()
ent, sal = interp.get_input_details()[0], interp.get_output_details()[0]


def mapa_tflite(img224):
    x = (np.asarray(img224, dtype=np.float32) / 127.5 - 1.0)[None]
    interp.set_tensor(ent["index"], x)
    interp.invoke()
    return interp.get_tensor(sal["index"])[0].astype(np.float32)


def preparar(img):
    p = img.resize((vision.LADO, vision.LADO))              # el servidor reduce con Pillow; el teléfono recibirá esta misma imagen
    return p, np.asarray(p, dtype=np.uint8)


ref_img, bandeja_img = bandeja(COMPLETA), bandeja(MITAD)
ref224, ref_px = preparar(ref_img)
ban224, ban_px = preparar(bandeja_img)

# ---- método del servidor (Keras), paso a paso igual que registrar_referencia() y analizar_bandeja()
d_ref, aspecto_ref = vision._zonas(ref_img)
umbral, claridad = vision._otsu(aspecto_ref)
comida = vision._alisar(aspecto_ref > umbral)
p_comida, p_fondo = vision._prototipos(d_ref[comida], 4), vision._prototipos(d_ref[~comida], 4)
comida, _ = vision._clasificar(d_ref, p_comida, p_fondo)
comida = vision._alisar(comida)
f_ref = float(comida.mean())
d_ban, _ = vision._zonas(bandeja_img)
es_comida, confianza = vision._clasificar(d_ban, p_comida, p_fondo)
es_comida = vision._alisar(es_comida)
restante = float(min(100.0, 100.0 * es_comida.mean() / f_ref))
d_sin_comida, _ = vision._zonas(bandeja({}))
sc, _ = vision._clasificar(d_sin_comida, p_comida, p_fondo)
restante_vacia = float(min(100.0, 100.0 * vision._alisar(sc).mean() / f_ref))

m_ref, m_ban = mapa_tflite(ref224), mapa_tflite(ban224)
muestra = [0, 777, 1500, 2222, 3135]
os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
json.dump({
    "ref": {"px": bytes_b64(ref_px), "mapa": bytes_b64(m_ref.astype(np.float16))},
    "bandeja": {"px": bytes_b64(ban_px), "mapa": bytes_b64(m_ban.astype(np.float16))},
    "vacia": {"px": bytes_b64(np.asarray(preparar(bandeja({}))[1], dtype=np.uint8)), "mapa": bytes_b64(mapa_tflite(preparar(bandeja({}))[0]).astype(np.float16))},
    "esperado": {"fRef": f_ref, "claridad": claridad, "restante": restante, "restanteVacia": restante_vacia, "confianza": confianza,
                 "zonasComidaRef": int(comida.sum()), "muestra": muestra, "descriptores": [d_ref[i].tolist() for i in muestra],
                 "aspecto": [float(aspecto_ref[i]) for i in muestra]},
}, open(SALIDA, "w"), separators=(",", ":"))
print(f"servidor: fRef={f_ref:.3f} restante={restante:.1f}% (bandeja a la mitad) vacía={restante_vacia:.1f}% confianza={confianza:.2f} claridad={claridad:.2f}")
print(f"guardado {os.path.normpath(SALIDA)} ({os.path.getsize(SALIDA) / 1024:.0f} KB)")
