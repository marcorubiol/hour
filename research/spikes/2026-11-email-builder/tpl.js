import { init, createDefaultTemplateContent } from '@templatical/editor';
import { createImageBlock, createTitleBlock, createParagraphBlock, createButtonBlock } from '@templatical/types';
import '@templatical/editor/style.css';

const content = createDefaultTemplateContent();
content.blocks = [
  createImageBlock({ src: 'https://picsum.photos/600/300', alt: 'Cartel del estreno', width: 'full' }),
  createTitleBlock({ content: 'Estreno: Obra de prueba', level: 1, textAlign: 'left' }),
  createParagraphBlock({ content: '<p>Te invitamos al estreno el 12 de diciembre en la sala.</p>' }),
  createButtonBlock({ text: 'Comprar entradas', url: 'https://example.org/entradas' }),
];

const editor = await init({ container: '#editor', locale: 'es', content, branding: false });
window.__editor = editor;
window.__export = async () => {
  const m = await editor.toMjml();
  return { mjml: m, json: JSON.stringify(editor.getContent()) };
};
window.__ready = true;
