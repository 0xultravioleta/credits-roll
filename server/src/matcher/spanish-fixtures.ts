import type { MomentKind } from '../domain.js';

// Fictional examples, written for this turn. No live stream recordings.
export const spanishFixtures: {
  name: string;
  chat: string;
  transcript: string;
  kind: MomentKind;
  changed: boolean;
}[] = [
  {
    name: 'Spanish idea',
    chat: 'Prueba el puente del norte',
    transcript: 'Buena idea, pruebo el puente del norte.',
    kind: 'idea',
    changed: true,
  },
  {
    name: 'Spanish assist',
    chat: 'Baja la música fuerte',
    transcript: 'Como dijo chat, baja la música fuerte; ya está.',
    kind: 'assist',
    changed: true,
  },
  {
    name: 'Spanish riff',
    chat: 'Llama al dragón Pan Tostado',
    transcript: 'Vamos con lo de chat: llama al dragón Pan Tostado.',
    kind: 'riff',
    changed: true,
  },
  {
    name: 'mixed adoption',
    chat: 'Prueba el puente del norte',
    transcript: "Good idea, let's try el puente del norte.",
    kind: 'idea',
    changed: true,
  },
  {
    name: 'Spanish topic only',
    chat: 'Prueba el puente del norte',
    transcript: 'El puente del norte aparece en el mapa.',
    kind: 'idea',
    changed: false,
  },
  {
    name: 'Spanish refusal',
    chat: 'Prueba el puente del norte',
    transcript: 'Buena idea, pero no voy a probar el puente del norte.',
    kind: 'idea',
    changed: false,
  },
];
