const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'out');

const buildOptions = {
    entryPoints: [path.join(root, 'src', 'extension.ts')],
    outfile: path.join(outdir, 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: false,
    minify: !watch,
    legalComments: 'none',
    external: ['vscode'],
    logLevel: 'info'
};

async function main() {
    if (!watch) {
        fs.rmSync(outdir, { recursive: true, force: true });
    }

    fs.mkdirSync(outdir, { recursive: true });

    if (watch) {
        const context = await esbuild.context(buildOptions);
        await context.watch();
        console.log('Watching extension host bundle...');
        return;
    }

    await esbuild.build(buildOptions);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});