// Menú lateral (sidebar): se abre con el botón ☰ de cada pantalla. Muestra solo lo que el rol puede usar.
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { C } from './tema';
import { ETIQUETA_ROL } from '../cuenta/auth';

// Quién puede usar «Desperdicio por foto»: el personal del comedor (el estudiante no analiza bandejas)
const ROLES_VISION = ['administrador', 'nutricionista', 'cocina_almacen', 'servicio_caja'];
export const puedeVerDesperdicio = (perfil) => (perfil.roles || [perfil.rol]).some((r) => ROLES_VISION.includes(r));

export default function Menu({ visible, onCerrar, perfil, pantalla, onIr, enLinea, pendientes }) {
  const x = useRef(new Animated.Value(-300)).current;
  useEffect(() => { Animated.timing(x, { toValue: visible ? 0 : -300, duration: 180, useNativeDriver: true }).start(); }, [visible, x]);

  const items = [
    { id: 'reportes', icono: '📊', titulo: 'Reportes', detalle: 'Por voz o texto, con IA local' },
    ...(puedeVerDesperdicio(perfil) ? [{ id: 'desperdicio', icono: '📷', titulo: 'Desperdicio por foto', detalle: 'IA local (TensorFlow Lite)' }] : []),
    { id: 'ajustes', icono: '⚙️', titulo: 'Ajustes', detalle: 'Cuenta, huella y servidor' },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View style={{ width: 290, backgroundColor: '#0b1220', borderRightWidth: 1, borderRightColor: C.borde, paddingTop: 54, transform: [{ translateX: x }] }}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.borde }}>
            <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: C.naranja, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>CU</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Comedor UAGRM</Text>
            <Text style={{ color: C.suave, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{perfil.nombre} · {ETIQUETA_ROL[perfil.rol] || perfil.rol}</Text>
            <Text style={{ color: enLinea ? C.verde : C.ambar, fontSize: 11, marginTop: 6 }}>{enLinea ? '● En línea' : '● Sin conexión (todo sigue funcionando)'}</Text>
          </View>
          <View style={{ padding: 10 }}>
            {items.map((i) => {
              const activo = pantalla === i.id;
              return (
                <TouchableOpacity key={i.id} onPress={() => onIr(i.id)} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 4,
                  backgroundColor: activo ? 'rgba(249,115,22,0.15)' : 'transparent', borderLeftWidth: 3, borderLeftColor: activo ? C.naranja : 'transparent' }}>
                  <Text style={{ fontSize: 22, width: 34 }}>{i.icono}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: activo ? '#fff' : C.texto, fontWeight: '600', fontSize: 15 }}>{i.titulo}</Text>
                    <Text style={{ color: C.tenue, fontSize: 11.5 }}>{i.detalle}</Text>
                  </View>
                  {i.id === 'desperdicio' && pendientes > 0 && (
                    <View style={{ backgroundColor: C.ambar, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: '#000', fontSize: 11, fontWeight: '700' }}>{pendientes}</Text></View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onCerrar} />
      </View>
    </Modal>
  );
}
