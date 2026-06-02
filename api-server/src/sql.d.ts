// Allow `import migration from '../../migrations/0001_initial.sql'` style
// text imports. Wrangler bundles these as raw strings via the
// `rules = [{ type = "Text", globs = ["**/*.sql"] }]` entry in wrangler.toml,
// and lib/autoMigrate.ts uses them to self-apply pending D1 migrations at
// cold-start time.
declare module '*.sql' {
  const content: string;
  export default content;
}
