import { PageHeader } from '../components/Charts';
import { AgrupacionVivo } from './client';

export const metadata = { title: 'Agrupación de platos' };

export default function SegmentacionPage() {
  return (
    <>
      <PageHeader title="Agrupación de platos" subtitle="Aprendizaje no supervisado (clustering · K-Means): cuáles mantener, ajustar o retirar del menú" />
      <AgrupacionVivo />
    </>
  );
}
