// Prueba de humo: la app arranca y muestra la pantalla de ingreso.
import 'package:comedor_movil/main.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('la app arranca y pide ingresar', (tester) async {
    // En la prueba no hay teléfono: el almacén seguro y la red se simulan (sin datos guardados y sin conexión).
    final mensajero = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    mensajero.setMockMethodCallHandler(const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'), (_) async => null);
    mensajero.setMockMethodCallHandler(const MethodChannel('dev.fluttercommunity.plus/connectivity'), (_) async => ['none']);
    addTearDown(() {
      mensajero.setMockMethodCallHandler(const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'), null);
      mensajero.setMockMethodCallHandler(const MethodChannel('dev.fluttercommunity.plus/connectivity'), null);
    });

    await tester.pumpWidget(const AppComedor());
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Comedor Universitario'), findsOneWidget);
    expect(find.text('Ingresar'), findsOneWidget);
  });
}
