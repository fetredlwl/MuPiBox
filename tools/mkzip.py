"""deploy.zip like the official one (PowerShell's Compress-Archive): files only, '/' as separator, made by
MS-DOS with only the archive bit - no Unix permissions, so unzip on the box gives its default ones (as with the
official package). Usage: python -I mkzip.py <folder> <zip>"""
import os
import sys
import time
import zipfile

src, out = sys.argv[1], sys.argv[2]
count = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        rel = os.path.relpath(root, src).replace(os.sep, '/')
        for f in sorted(files):
            path = os.path.join(root, f)
            name = f if rel == '.' else rel + '/' + f
            info = zipfile.ZipInfo(name, date_time=time.localtime(os.path.getmtime(path))[:6])
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0  # MS-DOS
            info.external_attr = 0x20  # archive bit only
            with open(path, 'rb') as fh:
                z.writestr(info, fh.read())
            count += 1
print(f'{count} Dateien')
