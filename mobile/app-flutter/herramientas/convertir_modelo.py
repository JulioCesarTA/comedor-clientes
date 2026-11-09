"""Convierte la red convolucional del servidor a TensorFlow Lite para que corra DENTRO del teléfono, sin internet.

Es exactamente la red de ia-ml-service/app/services/analitica/vision.py: MobileNetV2 (pesos ImageNet) recortada en la capa
`block_3_expand_relu` (mapa de 56x56 zonas con 144 características). Entrada: foto 224x224x3 con valores en [-1, 1].

Uso (necesita TensorFlow 2.17 e internet SOLO para bajar los pesos de ImageNet la primera vez):
    python herramientas/convertir_modelo.py
Genera assets/modelos/bandeja_mobilenetv2_b3.tflite y comprueba que TFLite y Keras dan lo mismo.
"""
import os

import numpy as np
import tensorflow as tf

LADO = 224
CAPA = "block_3_expand_relu"
SALIDA = os.path.join(os.path.dirname(__file__), "..", "assets", "modelos", "bandeja_mobilenetv2_b3.tflite")

base = tf.keras.applications.MobileNetV2(weights="imagenet", include_top=False, input_shape=(LADO, LADO, 3))
keras = tf.keras.Model(base.input, base.get_layer(CAPA).output)
print("salida de Keras:", keras.output_shape)

tflite = tf.lite.TFLiteConverter.from_keras_model(keras).convert()          # float32: misma precisión que el servidor
os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
with open(SALIDA, "wb") as f:
    f.write(tflite)
print(f"modelo guardado: {os.path.normpath(SALIDA)} ({len(tflite) / 1024:.0f} KB)")

# comprobación: mismo resultado en Keras y en TFLite
interp = tf.lite.Interpreter(model_content=tflite)
interp.allocate_tensors()
ent, sal = interp.get_input_details()[0], interp.get_output_details()[0]
print("entrada TFLite:", ent["shape"], ent["dtype"].__name__, "· salida TFLite:", sal["shape"], sal["dtype"].__name__)
rng = np.random.default_rng(0)
peor = 0.0
for _ in range(3):
    x = rng.uniform(-1, 1, (1, LADO, LADO, 3)).astype(np.float32)
    interp.set_tensor(ent["index"], x)
    interp.invoke()
    peor = max(peor, float(np.abs(interp.get_tensor(sal["index"])[0] - keras.predict(x, verbose=0)[0]).max()))
print(f"diferencia máxima Keras vs TFLite: {peor:.2e}")
assert peor < 1e-3, "TFLite no coincide con Keras"
