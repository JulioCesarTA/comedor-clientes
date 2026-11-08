import { PageHeader } from '../components/Charts';
import { ReportesIA } from './client';

export const metadata = { title: 'Reportes' };

export default function ReportesPage() {
  return (
    <>
      <PageHeader title="Reportes con IA" subtitle="Pídelo por texto o por voz: la IA arma la consulta, la muestra en tabla y gráfico y lo exporta a PDF, Excel o CSV"
        tags={['Texto y voz', 'Funciona sin internet']} />
      <ReportesIA />
    </>
  );
}
