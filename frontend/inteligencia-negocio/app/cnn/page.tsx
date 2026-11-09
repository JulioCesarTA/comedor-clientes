import { PageHeader } from '../components/Charts';
import { DesperdicioVivo } from './client';

export const metadata = { title: 'Desperdicio por foto' };

export default function CNNPage() {
  return (
    <>
      <PageHeader title="Desperdicio por foto" subtitle="Deep Learning (red convolucional · TensorFlow): qué % de la comida se comió cada persona, comparado con la porción de referencia" />
      <DesperdicioVivo />
    </>
  );
}
