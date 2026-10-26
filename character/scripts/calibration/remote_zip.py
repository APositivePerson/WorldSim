"""Read selected members of an HTTP range-capable public ZIP without downloading it all."""
import io, urllib.request

class RemoteZip(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0
        self.cache = []
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos
    def read(self, size=-1):
        size = self.size-self.pos if size < 0 else min(size, self.size-self.pos)
        if size <= 0: return b''
        start = self.pos
        for lo, data in self.cache:
            if lo <= start and start + size <= lo + len(data):
                self.pos += size
                return data[start-lo:start-lo+size]
        end = min(self.size-1, start+max(size,65536)-1)
        req = urllib.request.Request(self.url, headers={'Range':f'bytes={start}-{end}'})
        with urllib.request.urlopen(req, timeout=90) as response:
            if response.status != 206: raise RuntimeError('Server did not honor byte range')
            data = response.read()
            if len(data) != end-start+1: raise RuntimeError('Truncated ZIP range')
        self.cache.append((start,data)); self.pos += size
        return data[:size]
