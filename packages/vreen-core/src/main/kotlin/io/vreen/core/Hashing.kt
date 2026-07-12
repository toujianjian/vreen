package io.vreen.core

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** SHA-256 utilities. */
object Hashing {
    /**
     * Compute hex SHA-256 of the given bytes.
     * Constant-time encoding is unnecessary for SHA-256 (it's not a MAC).
     */
    fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val out = digest.digest(data)
        return out.toHex()
    }

    /** Streaming variant for very large arrays. */
    fun sha256HexStreamed(stream: java.io.InputStream, bufferSize: Int = 65536): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(bufferSize)
        while (true) {
            val n = stream.read(buf)
            if (n <= 0) break
            digest.update(buf, 0, n)
        }
        return digest.digest().toHex()
    }

    /** HMAC-SHA256 hex (for future authenticated manifest signing). */
    fun hmacSha256Hex(key: ByteArray, data: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data).toHex()
    }

    private fun ByteArray.toHex(): String {
        val sb = StringBuilder(size * 2)
        for (b in this) {
            val v = b.toInt() and 0xff
            sb.append(HEX[v ushr 4])
            sb.append(HEX[v and 0x0f])
        }
        return sb.toString()
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
