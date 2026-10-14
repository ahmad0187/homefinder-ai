import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { GEOCODE: 'off', ANTHROPIC_API_KEY: '', AUTO_REFRESH: 'off', DOTENV_CONFIG_PATH: '/nonexistent' },
  },
});
