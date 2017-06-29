'use strict'

class SteppedBuffer {

  constructor(step) {
    this.step = step
    this.buffer = Buffer.allocUnsafeSlow(step)
    this.dataSize = 0
    this.position = 0
    
    this.alloc = (stepsCount = 1) => {
      const _buffer = Buffer.allocUnsafeSlow(this.dataSize)
      this.buffer.copy(_buffer)
      this.buffer = Buffer.allocUnsafeSlow(this.buffer.length + step * stepsCount)
      _buffer.copy(this.buffer)
    }
    
    this.allocIfNeeded = (itemSize) => {
      const resultSize = Math.max(this.dataSize, this.position + itemSize)
      const diff = resultSize - this.buffer.length
      if (diff > 0) {
        this.alloc(Math.ceil(diff / this.step))
      }
      return resultSize
    }
    
    this.allocAnyway = (itemSize) => {
      const resultSize = this.dataSize + itemSize
      const diff = resultSize - this.buffer.length
      if (diff > 0) {
        this.alloc(Math.ceil(diff / this.step))
      }
      return resultSize
    }
  }
  
  addBuffer(buf) {
    const resultSize = this.allocIfNeeded(buf.length)
    buf.copy(this.buffer, this.position)
    this.dataSize = resultSize
    this.position += buf.length
    return true
  }
  
  addUInt(value, size) {
    const resultSize = this.allocIfNeeded(size)
    this.buffer.writeUIntBE(value, this.position, size)
    this.dataSize = resultSize
    this.position += size
    return true
  }
  
  seek(position) {
    this.position = position
    return true
  }
  
  forward(size) {
    this.position += size
    return true
  }
  
  tail() {
    this.position = this.dataSize
    return true
  }
  
  untilEnd() {
    return this.dataSize - this.position
  }
  
  readBuffer(size) {
    return this.position + size <= this.dataSize ? this.buffer.slice(this.position, this.position += size) : undefined
  }
  
  readBufferUntilEnd() {
    return this.readBuffer(this.untilEnd())
  }
  
  readUInt(size, preservePosition = false) {
    if (this.position + size <= this.dataSize) {
      const value = this.buffer.readUIntBE(this.position, size)
      if (!preservePosition) {
        this.position += size
      }
      return value
    } else {
      return
    }
  }
  
  reserve(size) {
    if (!this.untilEnd()) {
      return
    }
    const resultSize = this.allocAnyway(size)
    this.dataSize = resultSize
    this.buffer.copy(this.buffer, this.position + size, this.position)
    return true
  }
  
  removeTail(size) {
    this.dataSize -= size
    this.position = Math.min(this.dataSize, this.position)
    return true
  }
  
  remove(size) {
    this.buffer.copy(this.buffer, this.position, this.position + size)
    this.removeTail(size)
  }
  
  crop() {
    this.dataSize = this.position
    return true
  }
  
  clear() {
    this.dataSize = 0
    this.position = 0
    return true
  }
  
  getLength() {
    return this.dataSize
  }
  
  getSize() {
    return this.buffer.length
  }
  
  getWhole() {
    return this.buffer.slice(0, this.dataSize)
  }
  
  getSliced(start, end) {
    return this.buffer.slice(start, end ? Math.min(this.dataSize, end) : this.dataSize)
  }
  
  getRaw() {
    return this.buffer
  }
  
  getPosition() {
    return this.position
  }
}

module.exports = (step) => {
  return new SteppedBuffer(step)
}