import { createSignal } from 'solid-js';

export type Modality = 'pointer' | 'keyboard';

const [modality, setModality] = createSignal<Modality>('pointer');

document.addEventListener('keydown', () => setModality('keyboard'));
document.addEventListener('pointermove', () => setModality('pointer'));

export { modality };
