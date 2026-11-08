import { PageHeader } from '../components/Charts';
import { PrediccionVivo } from './client';

export const metadata = { title: 'Predicción de demanda' };

export default function PrediccionPage() {
  return (
    <>
      <PageHeader title="Predicción de demanda" subtitle="Aprendizaje supervisado (regresión · Random Forest) con los datos reales del comedor"
        tags={['Supervisado', 'Regresión', 'Tiempo real']} />
      <PrediccionVivo />
    </>
  );
}
