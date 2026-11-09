import { PageHeader } from '../components/Charts';
import { KpisVivo } from './client';

export const metadata = { title: 'KPI' };

export default function KpiPage() {
  return (
    <>
      <PageHeader title="Indicadores clave (KPI)" subtitle="Los 7 números que dicen cómo va el comedor, calculados en vivo con los datos reales" />
      <KpisVivo />
    </>
  );
}
