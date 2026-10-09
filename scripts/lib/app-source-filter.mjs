const OMIT_DIRECTORIES = new Set([
  '.git', '.stratexec', '.venv', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '__pycache__', 'build', 'coverage', 'credentials', 'dist', 'htmlcov',
  'node_modules', 'playwright-report', 'runtime-data', 'secrets', 'test-results',
]);
const OMIT_FILES = new Set(['.coverage', '.DS_Store', 'Thumbs.db']);

export function shouldOmitAppSourceEntry(name, isDirectory) {
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true;
  if (isDirectory) return OMIT_DIRECTORIES.has(name) || name.endsWith('.egg-info');
  return OMIT_FILES.has(name)
    || /\.(?:pyc|pyo|pyd|pfx|p12|pem|key|log|sqlite|sqlite3|db)(?:[.-].*)?$/i.test(name);
}
