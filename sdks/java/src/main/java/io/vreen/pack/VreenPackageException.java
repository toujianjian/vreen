package io.vreen.pack;

/**
 * Thrown by {@link VreenPackage} for any I/O / parse / validation error.
 * Mirrors the {@code VreenFormatError} class in {@code src/lib/vreenManifest.ts}.
 */
public class VreenPackageException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public VreenPackageException(String message) {
        super(message);
    }

    public VreenPackageException(String message, Throwable cause) {
        super(message, cause);
    }
}
