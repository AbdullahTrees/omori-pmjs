#!/usr/bin/env python3
"""Validate an OMORI (PMJS) release artifact and its device receipt.

Used by tools/release.sh before a GitHub release. Runs on Python 3 and reads
the ZIP directly, so it works in WSL, on Linux and on the build host.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

LAUNCHER = 'OMORI (PMJS).sh'
PORT = 'omori-pmjs/'
REQUIRED = [
    'port.json', 'gameinfo.xml', 'README.md', 'screenshot.png',
    'licenses/LICENSES.md', 'gamedata/README.txt', 'gamedata/omori-key.txt',
    'runtime/bin/node', 'runtime/bin/pmjs', 'runtime/lib/libatomic.so.1',
    'patches/character-frames.js', 'tools/extract.js', 'manifest.json',
]


def fail(message):
    print('release-check: ' + message, file=sys.stderr)
    return 1


def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return None
    width, height = struct.unpack('>II', data[16:24])
    return width, height


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', help='expected port source commit')
    parser.add_argument('--receipt')
    parser.add_argument('--require-receipt', action='store_true')
    parser.add_argument('--format', choices=['shell', 'json', 'text'], default='shell')
    args = parser.parse_args()

    artifact = Path(args.artifact)
    if not artifact.is_file():
        return fail('artifact not found: ' + str(artifact))
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    size = artifact.stat().st_size

    try:
        bundle = zipfile.ZipFile(artifact)
    except zipfile.BadZipFile as error:
        return fail('invalid ZIP: ' + str(error))
    with bundle:
        names = set(bundle.namelist())
        tops = sorted({name.split('/')[0] + ('/' if '/' in name else '') for name in names})
        if tops != [LAUNCHER, PORT]:
            return fail('unexpected top level: %s' % tops)
        for name in REQUIRED:
            if PORT + name not in names:
                return fail('missing ' + PORT + name)
        # A Windows build once shipped a CRLF launcher; it cannot start on the
        # handheld and exits before writing a log, so reject it before upload.
        for name in (LAUNCHER, PORT + 'runtime/bin/pmjs'):
            if b'\r\n' in bundle.read(name):
                return fail(name + ' has CRLF line endings')
        launcher = bundle.read(LAUNCHER).decode('utf-8', 'replace')
        if '@RELEASE_VERSION@' in launcher or '@PERF_EXTRA_DEFAULT@' in launcher:
            return fail('launcher still contains build placeholders')
        key_template = bundle.read(PORT + 'gamedata/omori-key.txt').decode('utf-8', 'replace')
        if re.search(r'(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])', key_template):
            return fail('gamedata/omori-key.txt contains a 32-character key')
        try:
            manifest = json.loads(bundle.read(PORT + 'manifest.json'))
        except (KeyError, ValueError) as error:
            return fail('bad manifest: ' + str(error))
        if manifest.get('version') != args.version:
            return fail('manifest version %r does not match %r' % (manifest.get('version'), args.version))
        source = (manifest.get('portSource') or {}).get('source') or {}
        if source.get('dirty'):
            return fail('artifact was built from a dirty source tree')
        if args.commit:
            if source.get('commit') != args.commit:
                return fail('artifact commit %r does not match %r' %
                            (source.get('commit'), args.commit))
        screenshot = bundle.read(PORT + 'screenshot.png')
        dimensions = png_size(screenshot)
        if dimensions != (640, 480):
            return fail('screenshot must be a 640x480 PNG, got %r' % (dimensions,))
        extract = bundle.read(PORT + 'tools/extract.js').decode('utf-8', 'replace')
        if re.search(r"['\"][0-9a-fA-F]{32}['\"]", extract):
            return fail('extract.js contains a hardcoded 32-character key')
        for source_name in ('appinfo.vdf', 'key.txt', 'OMORI_KEY', '--key'):
            if source_name not in extract:
                return fail('extract.js does not mention ' + source_name)
        licenses = [name for name in names
                    if name.startswith(PORT + 'licenses/') and not name.endswith('/')]
        if len(licenses) < 20:
            return fail('expected at least 20 license files, found %d' % len(licenses))

    receipt = None
    if args.receipt:
        try:
            receipt = json.loads(Path(args.receipt).read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            return fail('cannot read device receipt: ' + str(error))
        if receipt.get('schema') != 1:
            return fail('device receipt schema must be 1')
        if receipt.get('version') != args.version:
            return fail('device receipt version does not match')
        if receipt.get('sha256') != digest:
            return fail('device receipt sha256 does not match the artifact')
        for field in ('device', 'cfw', 'resolution', 'verifiedUtc'):
            if not isinstance(receipt.get(field), str) or not receipt[field].strip():
                return fail('device receipt missing ' + field)
        tests = receipt.get('tests')
        if not isinstance(tests, list) or not tests:
            return fail('device receipt has no tests')
        if not any(re.search(r'warm|launch|start|conversion|patch', str(test), re.I) for test in tests):
            return fail('device receipt tests do not include a launch/start result')
    elif args.require_receipt:
        return fail('a device receipt is required')

    result = {
        'check': 'ok',
        'version': args.version,
        'sha256': digest,
        'size': size,
        'commit': (manifest.get('portSource') or {}).get('source', {}).get('commit'),
        'dirty': bool((manifest.get('portSource') or {}).get('source', {}).get('dirty')),
        'receipt': bool(receipt),
    }
    if receipt:
        result['receipt_device'] = receipt.get('device', '')
        result['receipt_cfw'] = receipt.get('cfw', '')
        result['receipt_resolution'] = receipt.get('resolution', '')
        result['receipt_tests'] = '; '.join(str(test) for test in receipt.get('tests', []))
    if args.format == 'json':
        print(json.dumps(result, indent=2))
    elif args.format == 'text':
        for key, value in result.items():
            print('%s: %s' % (key, value))
    else:
        for key, value in result.items():
            print('%s=%s' % (key.upper(), value))
    return 0


if __name__ == '__main__':
    sys.exit(main())
