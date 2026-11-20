import json
import struct
from pathlib import Path

VERSION = 1


def crc16(data: bytes, seed: int = 0xFFFF) -> int:
    crc = seed
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def cobs_encode(data: bytes) -> bytes:
    output = bytearray([0])
    code_index = 0
    code = 1
    for byte in data:
        if byte == 0:
            output[code_index] = code
            code_index = len(output)
            output.append(0)
            code = 1
            continue
        output.append(byte)
        code += 1
        if code == 0xFF:
            output[code_index] = code
            code_index = len(output)
            output.append(0)
            code = 1
    output[code_index] = code
    return bytes(output)


def frame(msg_type: int, seq: int, body: bytes, version: int = VERSION) -> bytes:
    payload = struct.pack("<BBHH", version, msg_type, seq, len(body)) + body
    payload += struct.pack("<H", crc16(payload))
    return cobs_encode(payload) + b"\x00"


def rule(enabled, channel, comparison, threshold, hysteresis, delay, output, on, off, severity) -> bytes:
    return struct.pack("<BBBffHBHHB", enabled, channel, comparison, threshold, hysteresis, delay, output, on, off, severity)


def build():
    empty_rule = rule(0, 0, 0, 0.0, 0.0, 0, 0xFF, 0, 0, 0)
    rules_body = bytes([8]) + b"".join(bytes([slot, 0]) + empty_rule for slot in range(8))
    telemetry = struct.pack("<IBB", 123456, 0x01, 5) + struct.pack("<5f", 24.5, 63.25, 40.0, 4.98, 1.0)
    telemetry += struct.pack("<B3HB", 3, 1, 0, 750, 0x01)
    config = struct.pack("<HHBB", 1000, 10, 1, 30) + b"".join(struct.pack("<ff", 1.0, 0.0) for _ in range(5))
    info = struct.pack("<BBBBQBBBIBB", 1, 1, 0, 0, 0x0000A1B2C3D4E5F6, 5, 3, 8, 5000, 1, 2)
    valid = [
        ("hello", 0x01, 1, b""),
        ("ping", 0x02, 2, struct.pack("<I", 0xDEADBEEF)),
        ("set_output_relay", 0x10, 3, struct.pack("<BH", 0, 1)),
        ("set_output_fan", 0x10, 4, struct.pack("<BH", 2, 750)),
        ("ack_ok", 0x80, 3, bytes([0x10, 0])),
        ("ack_invalid", 0x80, 9, bytes([0x10, 2])),
        ("info", 0x81, 1, info),
        ("config", 0x83, 5, config),
        ("set_config", 0x11, 6, config),
        ("set_calibration", 0x12, 7, struct.pack("<Bff", 0, 1.0, 0.0)),
        ("set_rule", 0x13, 8, bytes([2]) + rule(1, 0, 0, 30.0, 1.5, 5, 2, 1000, 0, 2)),
        ("clear_rule", 0x14, 11, bytes([2])),
        ("rules_empty", 0x84, 12, rules_body),
        ("telemetry", 0x90, 10, telemetry),
        ("event_rule_on", 0x91, 13, struct.pack("<BBBfI", 2, 3, 0, 31.5, 98765)),
        ("seq_wrap", 0x02, 0xFFFF, struct.pack("<I", 0xFFFFFFFF)),
    ]
    vectors = {"version": VERSION, "valid": [], "invalid": []}
    for name, msg_type, seq, body in valid:
        vectors["valid"].append(
            {"name": name, "type": msg_type, "seq": seq, "body": body.hex(), "wire": frame(msg_type, seq, body).hex()}
        )
    good = bytearray(frame(0x02, 2, struct.pack("<I", 0xDEADBEEF)))
    payload = struct.pack("<BBHH", VERSION, 0x02, 2, 4) + struct.pack("<I", 0xDEADBEEF)
    bad_crc = payload + struct.pack("<H", crc16(payload) ^ 0x0001)
    wrong_length = struct.pack("<BBHH", VERSION, 0x02, 2, 9) + struct.pack("<I", 0xDEADBEEF)
    wrong_length += struct.pack("<H", crc16(wrong_length))
    vectors["invalid"] = [
        {"name": "crc", "wire": (cobs_encode(bad_crc) + b"\x00").hex(), "error": "crc"},
        {"name": "version", "wire": frame(0x02, 2, struct.pack("<I", 1), version=2).hex(), "error": "version"},
        {"name": "length", "wire": (cobs_encode(wrong_length) + b"\x00").hex(), "error": "length"},
        {"name": "short", "wire": (cobs_encode(bytes([1, 2, 3])) + b"\x00").hex(), "error": "short"},
        {"name": "cobs", "wire": bytes([0x05, 0x11, 0x22, 0x00]).hex(), "error": "cobs"},
    ]
    assert good[-1] == 0
    return vectors


def main():
    vectors = build()
    lines = ["{", f'  "version": {vectors["version"]},', '  "valid": [']
    lines += ["    " + json.dumps(v, separators=(",", ":")) + ("," if i < len(vectors["valid"]) - 1 else "") for i, v in enumerate(vectors["valid"])]
    lines += ["  ],", '  "invalid": [']
    lines += ["    " + json.dumps(v, separators=(",", ":")) + ("," if i < len(vectors["invalid"]) - 1 else "") for i, v in enumerate(vectors["invalid"])]
    lines += ["  ]", "}"]
    target = Path(__file__).with_name("vectors.json")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    json.loads(target.read_text(encoding="utf-8"))
    print(f"{len(vectors['valid'])} vetores válidos e {len(vectors['invalid'])} inválidos gravados em {target.name}")


if __name__ == "__main__":
    main()
