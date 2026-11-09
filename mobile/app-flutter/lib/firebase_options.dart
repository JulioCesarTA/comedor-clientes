// Datos de conexión del proyecto de Firebase (sw2p2). Salen de android/app/google-services.json.
// La apiKey de Firebase NO es un secreto: solo identifica el proyecto; lo que protege el envío es la cuenta de servicio
// del servidor (comedor-infra/respaldo/firebase-admin.json), que nunca viaja en la app.
import 'package:firebase_core/firebase_core.dart';

class DefaultFirebaseOptions {
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyC7g5smQFaD-xmNi63Y-ZsXNXJai1Ho8mM',
    appId: '1:117947839958:android:1d08cdb51a48597b1ea077',
    messagingSenderId: '117947839958',
    projectId: 'sw2p2-35344',
    storageBucket: 'sw2p2-35344.firebasestorage.app',
  );
}
