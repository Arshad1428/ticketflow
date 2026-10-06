import net from "node:net";
// ClamAV INSTREAM protocol. Set UPLOAD_SCAN_REQUIRED=true in production.
export async function scan(buffer) {
  if (!process.env.CLAMAV_HOST) {
    if (process.env.UPLOAD_SCAN_REQUIRED === "true")
      throw Object.assign(Error("Upload scanner is unavailable"), {
        status: 503,
      });
    return;
  }
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: process.env.CLAMAV_HOST,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let result = "";
    socket.setTimeout(15000);
    socket.on("timeout", () => socket.destroy(Error("Scanner timed out")));
    socket.on("error", () =>
      reject(
        Object.assign(Error("Upload scanner is unavailable"), { status: 503 }),
      ),
    );
    socket.on("data", (chunk) => {
      result += chunk.toString();
      if (result.includes("\0")) {
        socket.end();
        if (result.includes("OK")) resolve();
        else
          reject(
            Object.assign(Error("Attachment rejected by malware scanner"), {
              status: 400,
            }),
          );
      }
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        const chunk = buffer.subarray(offset, offset + 65536),
          size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
