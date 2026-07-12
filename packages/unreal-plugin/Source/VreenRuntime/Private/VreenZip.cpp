// VreenZip.cpp — minimal in-memory ZIP writer/reader.
//
// Strategy:
//   - Writer: emits local file header + raw (stored, no compression) entry
//     for simplicity, plus a central directory at the end. Tradeoff: not
//     compressed, but deterministic and dependency-free.
//   - Reader: scans local file headers, copies entry bytes into a TMap.
//
// For DEFLATE-compressed entries, use FCompression::CompressMemory in
// FCompressionFormat::Zlib. This file implements a simple stored-only
// scheme to keep the bootstrap minimal. Switch to deflate if/when files
// grow.

#include "VreenZip.h"
#include "HAL/PlatformTime.h"
#include "Misc/DateTime.h"
#include "Misc/Crc.h"

namespace
{
    static uint16 ReadU16LE(const uint8* P) { return (uint16)P[0] | ((uint16)P[1] << 8); }
    static uint32 ReadU32LE(const uint8* P) { return (uint32)P[0] | ((uint32)P[1] << 8) | ((uint32)P[2] << 16) | ((uint32)P[3] << 24); }
    static void WriteU16LE(TArray<uint8>& Buf, uint16 V) { Buf.Add(V & 0xFF); Buf.Add((V >> 8) & 0xFF); }
    static void WriteU32LE(TArray<uint8>& Buf, uint32 V) {
        Buf.Add(V & 0xFF); Buf.Add((V >> 8) & 0xFF); Buf.Add((V >> 16) & 0xFF); Buf.Add((V >> 24) & 0xFF);
    }
}

TArray<uint8> FVreenZip::Zip(const TMap<FString, TArray<uint8>>& Entries)
{
    TArray<uint8> Out;
    TArray<TPair<FString, uint32>> Offsets; // name → offset of local header

    auto Now = FDateTime::UtcNow();
    uint16 DosTime = (uint16)((Now.GetHour() << 11) | (Now.GetMinute() << 5) | (Now.GetSecond() / 2));
    uint16 DosDate = (uint16)(((Now.GetYear() - 1980) << 9) | (Now.GetMonth() << 5) | Now.GetDay());

    for (const auto& kv : Entries)
    {
        const FString& Name = kv.Key;
        const TArray<uint8>& Data = kv.Value;
        FTCHARToUTF8 NameConv(*Name);
        int NameLen = NameConv.Length();
        Offsets.Add(MakeTuple(Name, Out.Num()));

        // Local file header
        WriteU32LE(Out, 0x04034b50);  // signature
        WriteU16LE(Out, 20);          // version needed
        WriteU16LE(Out, 0x0800);      // flags: UTF-8 names
        WriteU16LE(Out, 0);           // method: stored
        WriteU16LE(Out, DosTime);
        WriteU16LE(Out, DosDate);
        WriteU32LE(Out, FCrc::MemCrc32(Data.GetData(), Data.Num()));  // CRC32
        WriteU32LE(Out, Data.Num());   // compressed size
        WriteU32LE(Out, Data.Num());   // uncompressed size
        WriteU16LE(Out, (uint16)NameLen);
        WriteU16LE(Out, 0);            // extra field length
        Out.Append((uint8*)NameConv.Get(), NameLen);
        Out.Append(Data);
    }

    // Central directory
    uint32 CdOffset = Out.Num();
    for (int i = 0; i < Entries.Num(); ++i)
    {
        const FString& Name = Offsets[i].Key;
        uint32 Off = Offsets[i].Value;
        const TArray<uint8>& Data = Entries.FindRef(Name);
        FTCHARToUTF8 NameConv(*Name);
        int NameLen = NameConv.Length();

        WriteU32LE(Out, 0x02014b50);
        WriteU16LE(Out, 20);          // version made by
        WriteU16LE(Out, 20);          // version needed
        WriteU16LE(Out, 0x0800);      // flags
        WriteU16LE(Out, 0);           // method
        WriteU16LE(Out, DosTime);
        WriteU16LE(Out, DosDate);
        WriteU32LE(Out, FCrc::MemCrc32(Data.GetData(), Data.Num()));
        WriteU32LE(Out, Data.Num());
        WriteU32LE(Out, Data.Num());
        WriteU16LE(Out, (uint16)NameLen);
        WriteU16LE(Out, 0);            // extra
        WriteU16LE(Out, 0);            // comment
        WriteU16LE(Out, 0);            // disk
        WriteU16LE(Out, 0);            // internal attrs
        WriteU32LE(Out, 0);            // external attrs
        WriteU32LE(Out, Off);
        Out.Append((uint8*)NameConv.Get(), NameLen);
    }
    uint32 CdSize = Out.Num() - CdOffset;

    // End of central directory
    WriteU32LE(Out, 0x06054b50);
    WriteU16LE(Out, 0);                  // disk
    WriteU16LE(Out, 0);                  // disk start
    WriteU16LE(Out, (uint16)Entries.Num());
    WriteU16LE(Out, (uint16)Entries.Num());
    WriteU32LE(Out, CdSize);
    WriteU32LE(Out, CdOffset);
    WriteU16LE(Out, 0);                  // comment len

    return Out;
}

TMap<FString, TArray<uint8>> FVreenZip::Unzip(const TArray<uint8>& Bytes)
{
    TMap<FString, TArray<uint8>> Out;
    if (Bytes.Num() < 4) return Out;
    const uint8* P = Bytes.GetData();
    int N = Bytes.Num();
    int i = 0;
    while (i + 4 <= N)
    {
        uint32 Sig = ReadU32LE(P + i);
        if (Sig != 0x04034b50) break; // not a local file header; stop.
        int NameLen = ReadU16LE(P + i + 26);
        int ExtraLen = ReadU16LE(P + i + 28);
        uint32 CompSize = ReadU32LE(P + i + 18);
        int DataStart = i + 30 + NameLen + ExtraLen;
        if (DataStart + (int)CompSize > N) break;
        FString Name(NumCharsToString((const ANSICHAR*)P + i + 30, NameLen));
        TArray<uint8> Data;
        Data.Append(P + DataStart, CompSize);
        Out.Add(Name, Data);
        i = DataStart + CompSize;
    }
    return Out;
}
