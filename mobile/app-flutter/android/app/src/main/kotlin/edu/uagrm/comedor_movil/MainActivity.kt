package edu.uagrm.comedor_movil

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val canal = "avisos_comedor"
    private val pedidoBloqueo = 4711
    private var respuestaBloqueo: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        crearCanalDeAvisos()
    }

    // Puente con Dart (un solo canal para las dos cosas que Android hace por nosotros):
    //  · mostrar:       notificación del sistema. Con la app ABIERTA Android no muestra solo los avisos de Firebase.
    //  · hayBloqueo / pedirBloqueo: la pantalla de patrón/PIN del teléfono. Nunca aparece el lector de huellas.
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "comedor/sistema").setMethodCallHandler { llamada, resultado ->
            when (llamada.method) {
                "mostrar" -> {
                    mostrarAviso(llamada.argument<String>("titulo") ?: "Comedor UAGRM", llamada.argument<String>("cuerpo") ?: "")
                    resultado.success(true)
                }
                "hayBloqueo" -> resultado.success(getSystemService(KeyguardManager::class.java).isDeviceSecure)
                "pedirBloqueo" -> pedirPatron(
                    llamada.argument<String>("titulo") ?: "Comedor UAGRM",
                    llamada.argument<String>("razon") ?: "Confirma tu patrón", resultado)
                else -> resultado.notImplemented()
            }
        }
    }

    private fun pedirPatron(titulo: String, razon: String, resultado: MethodChannel.Result) {
        val km = getSystemService(KeyguardManager::class.java)
        if (!km.isDeviceSecure) { resultado.success("sin_bloqueo"); return }
        if (respuestaBloqueo != null) { resultado.success("en_curso"); return }
        @Suppress("DEPRECATION")
        val intent = km.createConfirmDeviceCredentialIntent(titulo, razon)
        if (intent == null) { resultado.success("sin_bloqueo"); return }
        respuestaBloqueo = resultado
        @Suppress("DEPRECATION")
        startActivityForResult(intent, pedidoBloqueo)
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == pedidoBloqueo) {
            respuestaBloqueo?.success(if (resultCode == RESULT_OK) "ok" else "cancelado")
            respuestaBloqueo = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun mostrarAviso(titulo: String, cuerpo: String) {
        val abrir = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: return
        val pendiente = PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val aviso = Notification.Builder(this, canal)
            .setSmallIcon(R.drawable.ic_stat_aviso)
            .setContentTitle(titulo)
            .setContentText(cuerpo)
            .setStyle(Notification.BigTextStyle().bigText(cuerpo))
            .setAutoCancel(true)
            .setContentIntent(pendiente)
            .build()
        getSystemService(NotificationManager::class.java).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), aviso)
    }

    // El servidor manda los push al canal «avisos_comedor». Con importancia ALTA Android los muestra como cartel
    // emergente (con sonido) incluso con la pantalla encendida; en el canal por omisión solo aparecerían en la barra.
    private fun crearCanalDeAvisos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val c = NotificationChannel(canal, "Avisos del comedor", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Stock bajo, lotes por vencer y propuestas que esperan tu aprobación"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(c)
    }
}
