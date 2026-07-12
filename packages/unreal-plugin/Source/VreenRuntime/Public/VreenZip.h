// VreenZip.h — minimal ZIP (DEFLATE) reader/writer for .vreen packages.
// Pure UE5 (no zlib dep) — uses FCompression for deflate, manual central
// directory, and CRC32. Sufficient for the small file counts typical of
// .vreen archives. For production use cases with 100+ entries, prefer
// the engine's built-in FZipFileReader.

#pragma once

#include "CoreMinimal.h"

class VREENRUNTIME_API FVreenZip
{
public:
    /** Deflate-compress a TMap of entries to a zip-format byte array (DEFLATE level 6). */
    static TArray<uint8> Zip(const TMap<FString, TArray<uint8>>& Entries);

    /** Inflate all entries from a zip-format byte array. */
    static TMap<FString, TArray<uint8>> Unzip(const TArray<uint8>& Bytes);
};
