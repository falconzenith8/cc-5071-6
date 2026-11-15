import { App } from './app';

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

App.create(container).then((app) => {
  app.start();
  // Debug/test handle: lets e2e tests and devtools drive the scene.
  (window as unknown as { __app: App }).__app = app;
});
