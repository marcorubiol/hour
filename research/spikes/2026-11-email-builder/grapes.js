import grapesjs from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import mjml from 'grapesjs-mjml';
import es from 'grapesjs/locale/es.mjs';

const editor = grapesjs.init({
  container: '#editor',
  height: '100vh',
  storageManager: false,
  i18n: { locale: 'es', messages: { es } },
  plugins: [mjml],
  projectData: {
    pages: [{ component: `<mjml><mj-body><mj-section><mj-column>
      <mj-image src="https://picsum.photos/600/300" alt="Cartel del estreno"></mj-image>
      <mj-text font-size="20px">Estreno: Obra de prueba</mj-text>
      <mj-button href="https://example.org/entradas">Comprar entradas</mj-button>
    </mj-column></mj-section></mj-body></mjml>` }],
  },
});
window.__editor = editor;
window.__export = () => {
  const r = editor.runCommand('mjml-code-to-html');
  return { html: r.html, errors: r.errors, json: JSON.stringify(editor.getProjectData()) };
};
window.__ready = true;
