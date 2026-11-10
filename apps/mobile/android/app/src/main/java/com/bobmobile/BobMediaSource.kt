package com.bobmobile

import android.media.MediaDataSource

internal class BobMediaSource(private val transport: BobMediaTransport) : MediaDataSource() {
    override fun getSize(): Long = transport.size
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int = transport.readAt(position, buffer, offset, size)
    override fun close() = transport.close()
}
