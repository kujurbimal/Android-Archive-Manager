# Archive Manager

An Android-first local archive manager for importing files, creating ZIP archives, validating them, and extracting selected content.

## Run & Operate

- `pnpm --filter @workspace/archive-manager run dev` — run the Expo mobile app
- `pnpm --filter @workspace/api-server run dev` — run the shared API server (not currently required by the mobile app)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The mobile app stores library metadata in AsyncStorage and file contents in app-local storage.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Mobile: Expo, Expo Router, local file system APIs, AsyncStorage, and fflate ZIP processing

## Where things live

- `artifacts/archive-manager/app/` — Expo Router routes
- `artifacts/archive-manager/components/ArchiveWorkspace.tsx` — library, ZIP builder, and capability screens
- `artifacts/archive-manager/context/ArchiveContext.tsx` — local library persistence and file operations
- `artifacts/archive-manager/lib/archive.ts` — ZIP creation, central-directory validation, CRC checks, and extraction
- `artifacts/archive-manager/constants/colors.ts` — light and dark app colors

## Architecture decisions

- Archive processing stays on-device; the first build has no backend or account requirement.
- ZIP extraction validates paths, rejects encrypted / ZIP64 / unsupported entries, verifies CRC32, and limits archive and expanded sizes.
- Advanced items in the brief remain planned until their required native modules or service connections are implemented.

## Product

- Import files through the device picker, browse and search a local library, and preview small text/code files.
- Create ZIP archives with Quick, Balanced, and Maximum compression profiles.
- Inspect ZIP contents, test CRC32 integrity, extract selected files, and export files through the system share sheet.
- Other archive formats, encryption, multipart archives, AI organization, cloud access, media conversion, network sharing, and biometric vaulting are not implemented in the first build.

## User preferences

_No additional standing product preferences have been stated._

## Gotchas

- The first build handles ZIP files up to 64 MB, with a 200 MB expanded-content limit.
- The web preview uses browser blob URLs for local file operations; blob-backed entries do not survive a page reload. Native app storage persists normally.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
