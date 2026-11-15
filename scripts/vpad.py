#!/usr/bin/env python3
"""
A virtual Xbox 360 pad (Linux uinput) for testing gamepads in a real Chrome: Chrome sees it as a standard pad.
Needs python-evdev and write access to /dev/uinput. Chrome only hands pads to the focused, visible tab.

  python3 scripts/vpad.py [fifo]          # default fifo /tmp/vpad.cmd; prints "ready"
  echo A > /tmp/vpad.cmd                  # tap a button (A B X Y LB RB BACK START L3 R3), optional hold seconds: "A 0.5"
  echo "LX 32000" > /tmp/vpad.cmd         # set an axis: LX LY RX RY (-32768..32767), LT RT (0..255), HX HY (d-pad, -1..1)
  echo quit > /tmp/vpad.cmd
"""
import os, sys, time
from evdev import UInput, AbsInfo, ecodes as e

STICK = AbsInfo(0, -32768, 32767, 16, 128, 0)
TRIGGER = AbsInfo(0, 0, 255, 0, 0, 0)
HAT = AbsInfo(0, -1, 1, 0, 0, 0)
BUTTONS = {"A": e.BTN_A, "B": e.BTN_B, "X": e.BTN_X, "Y": e.BTN_Y, "LB": e.BTN_TL, "RB": e.BTN_TR,
           "BACK": e.BTN_SELECT, "START": e.BTN_START, "HOME": e.BTN_MODE, "L3": e.BTN_THUMBL, "R3": e.BTN_THUMBR}
AXES = {"LX": e.ABS_X, "LY": e.ABS_Y, "RX": e.ABS_RX, "RY": e.ABS_RY, "LT": e.ABS_Z, "RT": e.ABS_RZ, "HX": e.ABS_HAT0X, "HY": e.ABS_HAT0Y}
INFO = {"LT": TRIGGER, "RT": TRIGGER, "HX": HAT, "HY": HAT}

ui = UInput({e.EV_KEY: list(BUTTONS.values()), e.EV_ABS: [(code, INFO.get(name, STICK)) for name, code in AXES.items()]},
            name="Microsoft X-Box 360 pad", vendor=0x045E, product=0x028E, version=0x110, bustype=e.BUS_USB)
fifo = sys.argv[1] if len(sys.argv) > 1 else "/tmp/vpad.cmd"
if not os.path.exists(fifo):
    os.mkfifo(fifo)
print("ready", flush=True)
while True:
    with open(fifo) as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            cmd = p[0].upper()
            if cmd == "QUIT":
                ui.close()
                sys.exit()
            if cmd in BUTTONS:
                ui.write(e.EV_KEY, BUTTONS[cmd], 1); ui.syn()
                time.sleep(float(p[1]) if len(p) > 1 else 0.15)
                ui.write(e.EV_KEY, BUTTONS[cmd], 0); ui.syn()
            elif cmd in AXES:
                ui.write(e.EV_ABS, AXES[cmd], int(p[1])); ui.syn()
            else:
                print(f"unknown command: {line.strip()}", file=sys.stderr, flush=True)
