import { useEffect, useRef } from "react";

export default function Scanner({ open, onScan, onError }) {
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  }, [onScan, onError]);

  useEffect(() => {
    if (!open) return undefined;
    let scanner;
    let stillOpen = true;
    let decoded = false;
    import("html5-qrcode")
      .then(({ Html5QrcodeScanner }) => {
        if (!stillOpen) return;
        scanner = new Html5QrcodeScanner(
          "qr-reader",
          { fps: 8, qrbox: { width: 220, height: 220 }, rememberLastUsedCamera: false },
          false,
        );
        scanner.render(
          (value) => { if (stillOpen && !decoded) { decoded = true; onScanRef.current(value.trim()); } },
          (message) => {
            if (/camera|permission|notallowed|not found/i.test(message)) {
              onErrorRef.current?.("Allow camera access or choose a QR image to scan.");
            }
          },
        );
      })
      .catch(() => {
        if (stillOpen) onErrorRef.current?.("The QR scanner could not be loaded.");
      });
    return () => {
      stillOpen = false;
      if (scanner) scanner.clear().catch(() => {});
    };
  }, [open]);

  return open ? <div className="scanner-frame"><div id="qr-reader" /></div> : null;
}
