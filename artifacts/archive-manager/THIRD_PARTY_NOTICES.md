# Third-party notices

## 7z-wasm 1.2.0

The app uses the `7z-wasm` package, which contains 7-Zip 24.09 compiled to WebAssembly.
The app exposes 7z archive operations; it does not create RAR archives.

The package's JavaScript and WebAssembly files are licensed under the GNU LGPL with
the unRAR restriction. The remaining package files are licensed under the GNU LGPL.
These notices are reproduced from the package.

### 7-Zip license notice

7-Zip Copyright (C) 1999-2015 Igor Pavlov.

Licenses for files:

1. `7zz.*.js`, `7zz.wasm`: GNU LGPL + unRAR restriction.
2. All other files: GNU LGPL.

The GNU LGPL + unRAR restriction means that both sets of rules apply.

You can use 7-Zip on any computer, including a computer in a commercial organization.
You do not need to register or pay for 7-Zip.

This library is free software; you can redistribute it and/or modify it under the
terms of the GNU Lesser General Public License as published by the Free Software
Foundation, either version 2.1 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You can receive a copy of the GNU Lesser General Public License from
https://www.gnu.org/.

### unRAR restriction

The decompression engine for RAR archives was developed using source code of the
unRAR program. All copyrights to original unRAR code are owned by Alexander Roshal.

The unRAR sources cannot be used to re-create the RAR compression algorithm, which
is proprietary. Distribution of modified unRAR sources in separate form or as part
of other software is permitted, provided that the documentation and source comments
clearly state that the code may not be used to develop a RAR (WinRAR) compatible
archiver.

The unRAR source code is freeware. All copyrights to RAR and the unRAR utility are
exclusively owned by Alexander Roshal. The unRAR sources may be used in any software
to handle RAR archives without limitations free of charge, but cannot be used to
re-create the RAR compression algorithm. Distribution of modified unRAR sources in
separate form or as part of other software is permitted if the documentation and
source comments clearly state that the code may not be used to develop a
RAR (WinRAR)-compatible archiver.

The unRAR utility may be freely distributed. No person or company may charge a fee
for its distribution without written permission from the copyright holder. The RAR
archiver and unRAR utility are distributed "as is", without warranty; the author is
not liable for data loss or other damages from use or misuse. Installing and using
the utility signifies acceptance of these terms. If you do not agree to the terms,
you must remove the unRAR files and stop using the utility.
