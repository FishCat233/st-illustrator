import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));

// ST 全局模块的 specifier 替换表：源码里写语义化 specifier，
// 产物里替换成相对 dist/ 的真实路径。
// 产物位于 <ST>/public/scripts/extensions/st-illustrator/dist/，
// ST 的 script.js 在 <ST>/public/script.js，即 '../../../../script.js'。
const ST_SPECIFIER_MAP = {
    'st/script': '../../../../script.js',
    'st/events': '../../../../scripts/events.js',
    'st/utils': '../../../../scripts/utils.js',
    'st/st-context': '../../../../scripts/st-context.js',
    'st/constants': '../../../../scripts/constants.js',
    'st/extensions': '../../../../scripts/extensions.js',
};

const watch = process.argv.includes('--watch');

const ctx = await build({
    entryPoints: [resolve(root, 'src/main.ts')],
    outfile: resolve(root, 'dist/main.js'),
    bundle: true,
    format: 'esm',
    sourcemap: true,
    target: 'es2022',
    external: Object.keys(ST_SPECIFIER_MAP),
    plugins: [{
        name: 'st-specifier-rewrite',
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0) return;
                const outfile = resolve(root, 'dist/main.js');
                let code = await readFile(outfile, 'utf8');
                for (const [spec, real] of Object.entries(ST_SPECIFIER_MAP)) {
                    code = code.split(`"${spec}"`).join(`"${real}"`);
                }
                await writeFile(outfile, code);
            });
        },
    }],
});

if (!watch) {
    console.log('build done: dist/main.js');
} else {
    console.log('watching...');
}
