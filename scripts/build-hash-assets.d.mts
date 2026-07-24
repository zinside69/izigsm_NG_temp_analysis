export declare function hashContent(buffer: Uint8Array): string
export declare function rewriteStaticReferences(
  content: string,
  manifest: Record<string, string>
): string
export declare function hashAndRenameAssets(distDir: string): Record<string, string>
export declare function writeHeadersFile(distDir: string): void
