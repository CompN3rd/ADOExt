const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'media', 'webviews');

const buildOptions = {
    entryPoints: [
        path.join(root, 'src', 'views', 'webview', 'builds.ts'),
        path.join(root, 'src', 'views', 'webview', 'pipelineRunDetails.ts'),
        path.join(root, 'src', 'views', 'webview', 'prDetails.ts'),
        path.join(root, 'src', 'views', 'webview', 'workItemDetails.ts'),
        path.join(root, 'src', 'views', 'webview', 'planning.ts')
    ],
    outdir,
    entryNames: '[name]',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: false,
    legalComments: 'none',
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
        console.log('Watching webview bundles...');
        return;
    }

    await esbuild.build(buildOptions);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});