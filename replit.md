# Archive Manager

An Android-first local archive manager for importing files, creating and checking ZIP, 7z, TAR, TAR.GZ, and GZIP archives, and extracting selected content.

## Run & Operate

- `pnpm --filter @workspace/archive-manager run dev` — run the Expo mobile app
- `pnpm --filter @workspace/api-server run dev` — run the shared API server (not currently required by the mobile app)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The mobile app stores library metadata in AsyncStorage and file contents in app-local storage.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 6
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Mobile: Expo, Expo Router, local file system APIs, AsyncStorage, fflate, and the 7z WebAssembly engine

## Where things live

- `artifacts/archive-manager/app/` — Expo Router routes
- `artifacts/archive-manager/components/ArchiveWorkspace.tsx` — library, multi-format builder, and capability screens
- `artifacts/archive-manager/context/ArchiveContext.tsx` — local library persistence and file operations
- `artifacts/archive-manager/lib/archive.ts` — ZIP creation, central-directory validation, CRC checks, and local file I/O
- `artifacts/archive-manager/lib/archive-formats.ts` — format selection, creation, inspection, and extraction dispatch
- `artifacts/archive-manager/lib/archive-codecs.ts` — TAR and GZIP codecs and size-limited decompression
- `artifacts/archive-manager/lib/seven-zip.ts` — local 7z WebAssembly processing
- `artifacts/archive-manager/constants/colors.ts` — light and dark app colors

## Architecture decisions

- Archive processing stays on-device; the first build has no backend or account requirement.
- Archive extraction validates paths and rejects links/special files. ZIP CRC32 and GZIP checksums are verified; 7z is tested with its local engine.
- Archive inputs are limited to 64 MB, expanded content to 200 MB, and archive listings to 3,000 entries.
- 7z uses a Metro-packaged WASM asset via `expo-asset`; keep `.wasm` in `metro.config.js` asset extensions.
- Preserve `artifacts/archive-manager/THIRD_PARTY_NOTICES.md` when distributing the 7z engine.
- Advanced items in the brief remain planned until their required native modules or service connections are implemented.

## Product

- Import files through the device picker, browse and search a local library, and preview small text/code files.
- Create ZIP, 7z, TAR, TAR.GZ, or GZIP archives with compression profiles where supported. GZIP accepts one file; TAR is uncompressed.
- Inspect archives, test supported integrity checks, extract selected files, preview small text/code files, and export through the system share sheet.
- Password-protected and split archives, RAR/bzip2/XZ, AI organization, cloud access, media conversion, network sharing, and biometric vaulting are not implemented yet.

## User preferences

_No additional standing product preferences have been stated._

## Gotchas

- Archive files are limited to 64 MB, with a 200 MB expanded-content limit.
- 7z is processed locally with WebAssembly. Verify the WASM runtime on a physical Android device before release; the Replit preview alone does not validate Expo Go's native Hermes runtime.
- The web preview uses browser blob URLs for local file operations; blob-backed entries do not survive a page reload. Native app storage persists normally.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
