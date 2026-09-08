"""Build the distributable extension without tests or machine-specific pairing data."""
from pathlib import Path
import json
import re
import zipfile


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version):
        raise ValueError('Invalid extension version')
    target = root / 'dist' / f'scut-classroom-assistant-{version}.zip'
    target.parent.mkdir(exist_ok=True)
    paths = [p for p in source.rglob('*') if p.is_file() and not p.name.endswith('.test.js')
             and p.name != 'local-connection.js' and p.resolve().is_relative_to(source.resolve())
             and not any(part.startswith('.') or part == '__pycache__' for part in p.relative_to(source).parts)]
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, path.relative_to(source).as_posix())
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert json.loads(archive.read('manifest.json'))['version'] == version
        for path in {*manifest['icons'].values(), *manifest['action']['default_icon'].values(),
                     'brand.png', 'classroom.html', 'classroom.js', 'session-view.js'}:
            assert path in archive.namelist(), path
        assert not any(p.endswith('.test.js') or 'local-connection' in p for p in archive.namelist())
    print(f'{target} ({len(paths)} files, {target.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
