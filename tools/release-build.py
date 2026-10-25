#!/usr/bin/env python3
"""Build the OMORI-on-PMJS release package from a built PMJS runtime.

One artifact, one version, no accumulating per-date build trees:
  <out>/OMORI-PMJS-<version>.zip   (versioned copy)
  <out>/OMORI-PMJS.zip             (stable copy for sharing/installing)
  <out>/OMORI-PMJS-<version>.json  (manifest kept next to the zip)

The zip follows the PortMaster testing-zip layout: only the launcher and the
port folder at the top level. The port folder carries the PortMaster metadata
(port.json, gameinfo.xml, README.md), the runtime, patches, tools, an empty
gamedata/ drop folder, and licenses/ with one file per bundled component.
No game files are included; the launcher converts a Steam install in gamedata/
on first launch (or uses a pre-converted www/).

Run in WSL (the runtime is an ARM64 Linux tree with exec bits):
  python3 /mnt/c/.../omori-handover/tools/release-build.py \
      [--runtime ~/omori-test/pmjs-int3/dist/pmjs-arm64] \
      [--runtime-src ~/omori-test/pmjs-int3] [--out .../share/out]
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
SCRIPT = Path(__file__).resolve()
SOURCE_ROOT = SCRIPT.parent.parent
NOTICE_HEADER = 'The following license text is shipped with the corresponding component in this package.'
EXECUTABLE_ENTRIES = frozenset({
    'OMORI (PMJS).sh',
    'omori-pmjs/runtime/bin/node',
    'omori-pmjs/runtime/bin/pmjs',
})


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def git_state(path):
    try:
        commit = run('git', '-C', str(path), 'rev-parse', 'HEAD')
        short = run('git', '-C', str(path), 'rev-parse', '--short', 'HEAD')
        dirty = bool(run('git', '-C', str(path), 'status', '--porcelain'))
        branch = run('git', '-C', str(path), 'rev-parse', '--abbrev-ref', 'HEAD')
        return {'commit': commit, 'short': short, 'branch': branch, 'dirty': dirty}
    except (OSError, subprocess.CalledProcessError):
        return None


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def copy_tree(source, target):
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target, symlinks=True)


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def payload_inventory(root):
    files = {}
    for path in sorted(root.rglob('*')):
        rel = str(path.relative_to(root)).replace(os.sep, '/')
        if path.is_file() and not path.is_symlink():
            files[rel] = {'size': path.stat().st_size, 'sha256': sha256(path)}
        elif path.is_symlink():
            files[rel] = {'symlink': os.readlink(path)}
    return files


def zip_tree(source, output, epoch):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for root, dirs, files in os.walk(source):
            dirs.sort()
            rel = os.path.relpath(root, source)
            if rel != '.' and not files and not dirs:
                info = zipfile.ZipInfo(rel.replace(os.sep, '/') + '/')
                info.create_system = 3
                info.date_time = time.gmtime(max(315532800, epoch))[:6]
                info.external_attr = (0o40755 << 16) | 0x10
                bundle.writestr(info, b'')
            for name in sorted(files):
                path = Path(root) / name
                arc = os.path.relpath(path, source).replace(os.sep, '/')
                info = zipfile.ZipInfo(arc)
                # Info-ZIP ignores external_attr when the entry claims a FAT host.
                info.create_system = 3
                info.date_time = time.gmtime(max(315532800, epoch))[:6]
                info.compress_type = zipfile.ZIP_DEFLATED
                if path.is_symlink():
                    info.external_attr = (0o120777 << 16)
                    bundle.writestr(info, os.readlink(path))
                else:
                    # Write Unix modes explicitly: the builder also runs on Windows,
                    # where stat() carries no execute bits.
                    mode = 0o755 if arc in EXECUTABLE_ENTRIES else 0o644
                    info.external_attr = ((0o100000 | mode) << 16)
                    bundle.writestr(info, path.read_bytes(), compresslevel=9)


def license_map(notices, runtime, extra, with_libatomic):
    """(destination, [sources], description, header) for licenses/."""
    entries = [
        ('LICENSE-pmjs.txt', [runtime / 'LICENSE'], 'PMJS runtime (MIT)',
         'PMJS, the RPG Maker MV runtime bundled with this port.'),
        ('LICENSE-node.txt', [notices / 'Node.LICENSE'], 'Node.js 26.12.1 and bundled dependencies',
         'Node.js, including its bundled OpenSSL, ICU, nghttp2, libuv, brotli, c-ares and V8 notices.'),
        ('LICENSE-v8.txt', [notices / 'v8.LICENSE'], 'V8 JavaScript engine', NOTICE_HEADER),
        ('LICENSE-ffmpeg.txt',
         [notices / 'dependencies/ffmpeg/COPYING.LGPLv2.1', notices / 'dependencies/ffmpeg/LICENSE.md'],
         'FFmpeg 6.0 (libavcodec 60, libavformat 60, libavutil 58, libswresample 4, libswscale 7)',
         'FFmpeg 6.0, LGPL-2.1-or-later build without --enable-gpl or --enable-nonfree.'),
        ('LICENSE-skia.txt', [notices / 'skia65/Skia.LICENSE'], 'Skia', NOTICE_HEADER),
        ('LICENSE-icu.txt', [notices / 'skia65/ICU.LICENSE'], 'ICU (Skia build)', NOTICE_HEADER),
        ('LICENSE-freetype-skia.txt', [notices / 'skia65/FreeType.LICENSE', notices / 'skia65/FreeType.GPLv2'],
         'FreeType (Skia build)', NOTICE_HEADER),
        ('LICENSE-harfbuzz-skia.txt', [notices / 'skia65/HarfBuzz.LICENSE'], 'HarfBuzz (Skia build)', NOTICE_HEADER),
        ('LICENSE-freetype.txt',
         [notices / 'dependencies/freetype/LICENSE.TXT', notices / 'dependencies/freetype/FTL.TXT',
          notices / 'dependencies/freetype/GPLv2.TXT'],
         'FreeType 2.13.3', NOTICE_HEADER),
        ('LICENSE-harfbuzz.txt', [notices / 'dependencies/harfbuzz/COPYING'], 'HarfBuzz 8.3.0', NOTICE_HEADER),
        ('LICENSE-libpng.txt', [notices / 'dependencies/png/LICENSE'], 'libpng 1.6.43', NOTICE_HEADER),
        ('LICENSE-libjpeg-turbo.txt', [notices / 'dependencies/jpeg/LICENSE.md', notices / 'dependencies/jpeg/README.ijg'],
         'libjpeg-turbo 3.2.0', NOTICE_HEADER),
        ('LICENSE-libwebp.txt', [notices / 'dependencies/webp/COPYING', notices / 'dependencies/webp/PATENTS'],
         'libwebp and libsharpyuv', NOTICE_HEADER),
        ('LICENSE-zlib.txt', [notices / 'dependencies/zlib/LICENSE.md', extra / 'zlib-ng.LICENSE.md'],
         'zlib-ng 1.3.1 in zlib-compatible mode',
         'The bundled libz.so.1 is zlib-ng 1.3.1 in zlib-compatible mode. Both licenses follow.'),
        ('LICENSE-astcenc.txt', [notices / 'astcenc.LICENSE'], 'ARM ASTC Encoder 4.7.0', NOTICE_HEADER),
        ('LICENSE-lz4.txt', [notices / 'lz4.LICENSE'], 'LZ4 1.10.0', NOTICE_HEADER),
        ('LICENSE-effekseer.txt', [notices / 'effekseer.LICENSE'], 'Effekseer', NOTICE_HEADER),
        ('LICENSE-terrax.txt', [notices / 'terrax.LICENSE'], 'Terrax Lighting compatibility portions', NOTICE_HEADER),
        ('LICENSE-pixi.txt', [notices / 'pixi4.LICENSE'], 'PixiJS 4.5.4 shader contract and pixel reference', NOTICE_HEADER),
        ('LICENSE-unicode.txt', [notices / 'unicode.LICENSE'], 'Unicode data', NOTICE_HEADER),
        ('LICENSE-liberation-font.txt', [runtime / 'share/pmjs/js/pmjs-web/fallback-font.LICENSE'],
         'Liberation Sans subset (fallback font)', NOTICE_HEADER),
    ]
    if with_libatomic:
        entries.append(('LICENSE-libatomic.txt', [extra / 'libatomic.LICENSE.txt'],
                        'libatomic (GCC runtime library)', 'libatomic is part of the GNU Compiler Collection.'))
    return entries


def stage_licenses(port, notices, runtime, extra, with_libatomic):
    licenses = port / 'licenses'
    licenses.mkdir()
    rows = []
    for destination, sources, component, header in license_map(notices, runtime, extra, with_libatomic):
        missing = [str(source) for source in sources if not source.is_file()]
        if missing:
            raise SystemExit('license source missing: ' + ', '.join(missing))
        target = licenses / destination
        with target.open('w', encoding='utf-8', errors='replace') as stream:
            stream.write(header + '\n\n')
            for index, source in enumerate(sources):
                if index:
                    stream.write('\n\n===== %s =====\n\n' % source.name)
                stream.write(source.read_text(encoding='utf-8', errors='replace'))
        rows.append('| `%s` | %s |' % (destination, component))
    write_text(licenses / 'LICENSES.md',
               '# Bundled components and licenses\n\n'
               '| File | Component |\n| --- | --- |\n' + '\n'.join(rows) + '\n\n'
               'SDL2, EGL, GLESv2 and the GPU driver are provided by the firmware and are not bundled. '
               'The port\'s launcher and JavaScript patches are part of this package; their license is not declared yet.\n')
    return len(rows)


def stage_metadata(port, metadata, require_screenshot):
    for name in ('port.json', 'gameinfo.xml', 'README.md'):
        source = metadata / name
        if not source.is_file():
            raise SystemExit('metadata file missing: ' + str(source))
        copy_file(source, port / name)
    testing = metadata / 'testing_thread.txt'
    if testing.is_file():
        copy_file(testing, port / 'testing_thread.txt')
    screenshot = metadata / 'screenshot.png'
    if screenshot.is_file():
        copy_file(screenshot, port / 'screenshot.png')
    elif require_screenshot:
        raise SystemExit('screenshot.png is required but missing in ' + str(metadata))
    else:
        print('warning: no screenshot.png in metadata; gameinfo.xml still references it', file=sys.stderr)
    cover = metadata / 'cover.png'
    if cover.is_file():
        copy_file(cover, port / 'cover.png')
    gamedata = port / 'gamedata'
    gamedata.mkdir()
    write_text(gamedata / 'README.txt',
               'Copy your OMORI installation here, so that gamedata/www/index.html exists.\n'
               'The launcher converts it to ../www/ on first launch. See ../README.md.\n')


def normalize_modes(stage, port):
    for path in stage.rglob('*'):
        if not path.is_file() or path.is_symlink():
            continue
        executable = path in (stage / 'OMORI (PMJS).sh', port / 'runtime/bin/node', port / 'runtime/bin/pmjs')
        path.chmod(0o755 if executable else 0o644)


def add_libatomic(port, source):
    target = port / 'runtime/lib/libatomic.so.1'
    shutil.copyfile(source, target)
    target.chmod(0o644)
    return target


def validate_stage(stage, port):
    top = sorted(path.name for path in stage.iterdir())
    if top != ['OMORI (PMJS).sh', 'omori-pmjs']:
        raise SystemExit('unexpected staging top level: %s' % top)
    for name in ('port.json', 'gameinfo.xml', 'README.md', 'licenses/LICENSES.md', 'gamedata'):
        if not (port / name).exists():
            raise SystemExit('staged package is missing ' + name)
    for path in stage.rglob('*'):
        if path.is_symlink():
            raise SystemExit('staged package contains a symlink: ' + str(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path,
                        default=Path.home() / 'omori-test/pmjs-int3/dist/pmjs-arm64')
    parser.add_argument('--runtime-src', type=Path,
                        default=Path.home() / 'omori-test/pmjs-int3')
    parser.add_argument('--port-source', type=Path,
                        help='OmoriSource checkout to stage and record; defaults to the tool tree')
    parser.add_argument('--port-source-label',
                        help='Source label in the public manifest; defaults to the checkout directory name')
    parser.add_argument('--out', type=Path, default=SOURCE_ROOT / 'share' / 'out')
    parser.add_argument('--metadata', type=Path, default=SOURCE_ROOT / 'share/omori-pmjs/metadata')
    parser.add_argument('--licenses-extra', type=Path, default=SOURCE_ROOT / 'share/omori-pmjs/licenses-extra')
    parser.add_argument('--version', help='Release version; default date-<runtime sha>-<omori sha>')
    parser.add_argument('--perf-extra', choices=['0', '1'], default='1',
                        help='Default for PMJS_PERF_EXTRA in the launcher (1 = load launcher/perf/*.js)')
    parser.add_argument('--keep', action='store_true', help='Keep older versioned zips in the output folder')
    parser.add_argument('--epoch', type=int, help='Zip timestamp epoch (default: runtime commit time)')
    parser.add_argument('--strip', help='strip executable (default: llvm-strip-20/llvm-strip/strip on PATH)')
    parser.add_argument('--no-strip', action='store_true', help='Keep debug symbols (larger package)')
    parser.add_argument('--libatomic', type=Path,
                        default=Path.home() / 'omori-test/libatomic/root/usr/lib/aarch64-linux-gnu/libatomic.so.1.2.0',
                        help='ARM64 libatomic.so.1 to bundle (Node hard-links it)')
    parser.add_argument('--no-libatomic', action='store_true', help='Do not bundle libatomic')
    parser.add_argument('--require-screenshot', action='store_true',
                        help='Fail if metadata/screenshot.png is missing')
    args = parser.parse_args()

    repo = (args.port_source or SOURCE_ROOT).resolve()
    runtime = args.runtime.resolve()
    runtime_src = args.runtime_src.resolve()
    out = args.out.resolve()
    metadata = args.metadata.resolve()
    extra = args.licenses_extra.resolve()

    for required in (runtime / 'bin/node', runtime / 'bin/pmjs', runtime / 'lib/pmjs_native.node',
                     runtime / 'build-info.json', runtime / 'share/pmjs/notices'):
        if not required.exists():
            parser.exit(2, 'runtime is incomplete: missing %s\n' % required)
    if not (repo / 'launcher/omori-performance.js').is_file():
        parser.exit(2, 'OmoriSource not found at %s\n' % repo)
    if not args.no_libatomic and not args.libatomic.is_file():
        parser.exit(2, 'libatomic not found at %s (or pass --no-libatomic)\n' % args.libatomic)

    omori = git_state(repo)
    pmjs = git_state(runtime_src)
    build_info = json.loads((runtime / 'build-info.json').read_text())

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d')
    version = args.version
    if not version:
        runtime_id = pmjs['short'] if pmjs else 'runtime'
        omori_id = omori['short'] if omori else 'omori'
        version = '%s-%s-%s' % (stamp, runtime_id, omori_id)
    if any(ch in version for ch in '/\\ :'):
        parser.exit(2, 'version contains characters unsafe for a file name: %s\n' % version)

    epoch = args.epoch
    if epoch is None:
        try:
            epoch = int(run('git', '-C', str(runtime_src), 'show', '-s', '--format=%ct', 'HEAD'))
        except (OSError, subprocess.CalledProcessError):
            epoch = int(time.time())

    stage = Path(tempfile.mkdtemp(prefix='omori-release-'))
    port = stage / 'omori-pmjs'
    try:
        copy_tree(runtime, port / 'runtime')
        if not args.no_strip:
            strip_tool = (args.strip or shutil.which('llvm-strip-20') or
                          shutil.which('llvm-strip') or shutil.which('strip'))
            if not strip_tool:
                print('warning: no strip tool found; package keeps debug symbols', file=sys.stderr)
            else:
                stripped = 0
                for folder in ('bin', 'lib'):
                    for path in (port / 'runtime' / folder).glob('*'):
                        if not path.is_file() or path.is_symlink():
                            continue
                        if path.read_bytes()[:4] != b'\x7fELF':
                            continue
                        subprocess.run([strip_tool, '--strip-unneeded', str(path)], check=True)
                        stripped += 1
                print('stripped %d ELF files with %s' % (stripped, strip_tool))
        if not args.no_libatomic:
            target = add_libatomic(port, args.libatomic)
            print('bundled %s (%.1f KiB)' % (target.relative_to(port), target.stat().st_size / 1024))

        patches = port / 'patches'
        patches.mkdir(parents=True)
        for name in ('omori-performance.js', 'omori-fps-log.js'):
            copy_file(repo / 'launcher' / name, patches / name)
        copy_file(repo / 'launcher/pmjs/character-frames.js', patches / 'character-frames.js')

        perf_dir = port / 'perf'
        perf_dir.mkdir()
        perf_modules = sorted(path for path in (repo / 'launcher/perf').glob('*.js')
                              if path.is_file())
        for module in perf_modules:
            copy_file(module, perf_dir / module.name)

        tools = port / 'tools'
        tools.mkdir()
        for name in ('extract.js', 'steam-to-reference.patch', 'reference.sha256'):
            copy_file(repo / 'tools' / name, tools / name)

        (port / 'config.json').write_text(
            '{\n  "assetPreparation": {\n    "workspaceBytes": 67108864\n  }\n}\n', encoding='utf-8')
        (port / 'VERSION').write_text(version + '\n', encoding='utf-8')

        stage_metadata(port, metadata, args.require_screenshot)
        license_count = stage_licenses(port, port / 'runtime/share/pmjs/notices', port / 'runtime',
                                       extra, not args.no_libatomic)
        print('staged %d license files' % license_count)

        launcher_source = (SOURCE_ROOT / 'share/omori-pmjs/OMORI (PMJS).sh').read_text(encoding='utf-8')
        launcher = (launcher_source
                    .replace('@PERF_EXTRA_DEFAULT@', args.perf_extra)
                    .replace('@RELEASE_VERSION@', version))
        (stage / 'OMORI (PMJS).sh').write_text(launcher, encoding='utf-8')
        os.chmod(stage / 'OMORI (PMJS).sh', 0o755)

        manifest = {
            'schema': SCHEMA,
            'version': version,
            'builtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'fastPaths': {'default': args.perf_extra == '1',
                          'modules': [module.name for module in perf_modules]},
            'runtime': {'source': pmjs, 'buildInfo': build_info},
            'portSource': {'source': omori, 'repo': args.port_source_label or repo.name},
            'payload': payload_inventory(port),
        }
        (port / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

        normalize_modes(stage, port)
        validate_stage(stage, port)

        out.mkdir(parents=True, exist_ok=True)
        versioned = out / ('OMORI-PMJS-%s.zip' % version)
        stable = out / 'OMORI-PMJS.zip'
        zip_tree(stage, versioned, epoch)
        shutil.copyfile(versioned, stable)
        digest = sha256(versioned)
        (out / ('OMORI-PMJS-%s.zip.sha256' % version)).write_text(
            '%s  %s\n' % (digest, versioned.name), encoding='utf-8')
        (out / 'OMORI-PMJS.zip.sha256').write_text(
            '%s  %s\n' % (digest, stable.name), encoding='utf-8')
        (out / ('OMORI-PMJS-%s.json' % version)).write_text(
            json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        if not args.keep:
            for old in out.glob('OMORI-PMJS-*.zip'):
                if old != versioned:
                    old.unlink()
            for old in out.glob('OMORI-PMJS-*.zip.sha256'):
                if old.name != 'OMORI-PMJS-%s.zip.sha256' % version:
                    old.unlink()
            for old in out.glob('OMORI-PMJS-*.json'):
                if old.name != 'OMORI-PMJS-%s.json' % version:
                    old.unlink()

        print('version  %s' % version)
        print('runtime  %s' % ((pmjs['branch'] + '@' + pmjs['short']) if pmjs else 'unknown'))
        print('fastpaths %s (%d modules)' % ('on' if args.perf_extra == '1' else 'off', len(perf_modules)))
        print('wrote    %s (%.1f MiB, sha256 %s)' % (versioned, versioned.stat().st_size / 1048576, digest))
        print('wrote    %s' % stable)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == '__main__':
    main()
