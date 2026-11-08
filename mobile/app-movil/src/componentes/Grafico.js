// Gráfico del reporte (barras, líneas o torta) dibujado con SVG: sin internet y sin librerías de gráficos.
import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as T } from 'react-native-svg';
import { C, PALETA } from './tema';

const corto = (s, n = 9) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export default function Grafico({ res }) {
  const g = res.grafico;
  const { width } = useWindowDimensions();
  if (!g || !res.filas.length || res.filas.length > 40) return null;
  const W = width - 56, H = 220;
  const etq = res.filas.map((f) => String(f[g.x] ?? ''));
  const series = g.y.map((k) => res.filas.map((f) => Number(f[k]) || 0));
  const leyenda = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
      {g.y.map((k, i) => <Text key={k} style={{ color: g.tipo === 'torta' ? C.suave : PALETA[i % 2], fontSize: 11, marginRight: 12 }}>■ {g.etiquetas[k] || k}</Text>)}
    </View>
  );

  if (g.tipo === 'torta') {
    const total = series[0].reduce((a, b) => a + b, 0) || 1;
    const cx = 90, cy = 100, r = 80;
    let ang = -Math.PI / 2;
    const trozos = series[0].map((v, i) => {
      const a2 = ang + (v / total) * Math.PI * 2;
      const p = [cx + r * Math.cos(ang), cy + r * Math.sin(ang), cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
      const el = v / total >= 0.9999
        ? <Circle key={i} cx={cx} cy={cy} r={r} fill={PALETA[(i + 2) % 6]} />
        : <Path key={i} d={`M${cx},${cy} L${p[0]},${p[1]} A${r},${r} 0 ${v / total > 0.5 ? 1 : 0} 1 ${p[2]},${p[3]} Z`} fill={PALETA[(i + 2) % 6]} />;
      ang = a2;
      return el;
    });
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Svg width={180} height={200}>{trozos}</Svg>
        <View style={{ flex: 1 }}>
          {etq.map((e, i) => <Text key={i} style={{ color: C.texto, fontSize: 12, marginVertical: 2 }}><Text style={{ color: PALETA[(i + 2) % 6] }}>■ </Text>{corto(e, 16)} ({num(series[0][i])})</Text>)}
        </View>
      </View>
    );
  }

  const L = 38, B = 46, Tp = 10, R = 8;
  const max = Math.max(...series.flat(), 1);
  const iw = W - L - R, ih = H - Tp - B;
  const y = (v) => Tp + ih - (v / max) * ih;
  const paso = iw / etq.length;
  const cx = (i) => L + paso * i + paso / 2;
  const rotar = etq.length > 5;
  return (
    <View style={{ marginBottom: 10 }}>
      <Svg width={W} height={H}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <G key={p}>
            <Line x1={L} x2={W - R} y1={y(max * p)} y2={y(max * p)} stroke={C.borde} strokeWidth={0.6} />
            <T x={L - 5} y={y(max * p) + 3} fontSize={9} fill={C.tenue} textAnchor="end">{num(max * p)}</T>
          </G>
        ))}
        {g.tipo === 'lineas'
          ? series.map((s, k) => (
            <G key={k}>
              <Polyline points={s.map((v, i) => `${cx(i)},${y(v)}`).join(' ')} fill="none" stroke={PALETA[k % 2]} strokeWidth={2.5} />
              {s.map((v, i) => <Circle key={i} cx={cx(i)} cy={y(v)} r={3.5} fill={PALETA[k % 2]} />)}
            </G>
          ))
          : series.map((s, k) => {
            const ancho = Math.min(34, (paso * 0.7) / series.length);
            return s.map((v, i) => <Rect key={`${k}-${i}`} x={cx(i) - (ancho * series.length) / 2 + ancho * k} y={y(v)} width={ancho} height={Tp + ih - y(v)} rx={3} fill={PALETA[k % 2]} />);
          })}
        {etq.map((e, i) => (
          <T key={i} x={cx(i)} y={H - B + 12} fontSize={9} fill={C.suave} textAnchor={rotar ? 'end' : 'middle'} transform={rotar ? `rotate(-35 ${cx(i)} ${H - B + 12})` : undefined}>{corto(e, 10)}</T>
        ))}
      </Svg>
      {leyenda}
    </View>
  );
}
