"""scratch_runtime.py: how Scratch runs a project, for a game exported from Flipwarp.

The game's own code is in main.py; this file is the engine under it: sprites,
costumes, clones, broadcasts, the pen, sounds, the keyboard and mouse, and
Scratch's rules for numbers and text.

Each script is a generator function. Where Scratch would let other scripts have
a turn (the end of each pass round a loop, a wait), the script yields. Every
frame the engine gives each running script a turn, in the order Scratch would,
until something on the stage changed, then draws.

Needs pygame:  pip install pygame
"""

import inspect
import math
import os
import random
import re
import time

import pygame


# --- Scratch's rules for values ----------------------------------------------

class S:
    """Scratch's rules for numbers, text, comparisons and lists."""

    @staticmethod
    def num(value):
        """A value as a number, the way Scratch casts it: anything not a number is 0."""
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        if isinstance(value, (int, float)):
            return 0.0 if value != value else float(value)
        n = js_parse_number(str(value))
        return 0.0 if n != n else n

    @staticmethod
    def bool(value):
        """A value as true or false: "", "0" and "false" are false."""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return not (value == '' or value == '0' or value.lower() == 'false')
        return bool(value)

    @staticmethod
    def str(value):
        """A value as text, written the way Scratch (JavaScript) writes it."""
        if isinstance(value, bool):
            return 'true' if value else 'false'
        if isinstance(value, (int, float)):
            return js_number(float(value))
        return str(value)

    @staticmethod
    def compare(a, b):
        """Compare like Scratch: as numbers when both are numbers, else as text ignoring case."""
        n1 = maybe_number(a)
        n2 = maybe_number(b)
        if n1 is None or n2 is None:
            s1 = S.str(a).lower()
            s2 = S.str(b).lower()
            return -1 if s1 < s2 else (1 if s1 > s2 else 0)
        if n1 == n2:
            return 0
        return -1 if n1 < n2 else 1

    @staticmethod
    def lt(a, b):
        return S.compare(a, b) < 0

    @staticmethod
    def gt(a, b):
        return S.compare(a, b) > 0

    @staticmethod
    def eq(a, b):
        return S.compare(a, b) == 0

    @staticmethod
    def random(a, b):
        """pick random a to b: whole numbers unless either end has a decimal point."""
        n1 = S.num(a)
        n2 = S.num(b)
        low, high = min(n1, n2), max(n1, n2)
        if low == high:
            return low
        if is_int(a) and is_int(b):
            return float(random.randint(int(low), int(high)))
        return random.random() * (high - low) + low

    @staticmethod
    def div(a, b):
        if b == 0:
            if a == 0 or a != a:
                return math.nan
            return math.inf if a > 0 else -math.inf
        return a / b

    @staticmethod
    def mod(a, b):
        n = S.num(a)
        m = S.num(b)
        if m == 0:
            return math.nan
        result = math.fmod(n, m)
        if result / m < 0:
            result += m
        return result

    @staticmethod
    def round(value):
        n = S.num(value)
        if math.isinf(n) or n != n:
            return n
        return float(math.floor(n + 0.5))

    @staticmethod
    def mathop(op, value):
        n = S.num(value)
        op = str(op).lower()
        try:
            if op == 'abs':
                return abs(n)
            if op == 'floor':
                return float(math.floor(n)) if math.isfinite(n) else n
            if op == 'ceiling':
                return float(math.ceil(n)) if math.isfinite(n) else n
            if op == 'sqrt':
                return math.sqrt(n) if n >= 0 else math.nan
            if op == 'sin':
                return round(math.sin(math.radians(n)) * 1e10) / 1e10
            if op == 'cos':
                return round(math.cos(math.radians(n)) * 1e10) / 1e10
            if op == 'tan':
                angle = math.fmod(n, 360)
                if angle in (-270, 90):
                    return math.inf
                if angle in (-90, 270):
                    return -math.inf
                return round(math.tan(math.radians(n)) * 1e10) / 1e10
            if op == 'asin':
                return math.degrees(math.asin(n)) if -1 <= n <= 1 else math.nan
            if op == 'acos':
                return math.degrees(math.acos(n)) if -1 <= n <= 1 else math.nan
            if op == 'atan':
                return math.degrees(math.atan(n))
            if op == 'ln':
                return -math.inf if n == 0 else (math.log(n) if n > 0 else math.nan)
            if op == 'log':
                return -math.inf if n == 0 else (math.log10(n) if n > 0 else math.nan)
            if op == 'e ^':
                return math.exp(n) if n < 710 else math.inf
            if op == '10 ^':
                return 10.0 ** n if n < 309 else math.inf
        except (ValueError, OverflowError):
            return math.nan
        return 0.0

    @staticmethod
    def join(a, b):
        return S.str(a) + S.str(b)

    @staticmethod
    def letter_of(index, text):
        s = S.str(text)
        i = int(S.num(index)) - 1 if math.isfinite(S.num(index)) else -1
        if i < 0 or i >= len(s):
            return ''
        return s[i]

    @staticmethod
    def length_of(text):
        return float(len(S.str(text)))

    @staticmethod
    def contains(text, part):
        return S.str(part).lower() in S.str(text).lower()

    # Lists: Python lists, changed in place, numbered from 1 like Scratch.
    @staticmethod
    def list_add(lst, item):
        lst.append(item)

    @staticmethod
    def list_delete(lst, index):
        i = list_index(index, len(lst), True)
        if i == 'all':
            del lst[:]
        elif i:
            del lst[i - 1]

    @staticmethod
    def list_delete_all(lst):
        del lst[:]

    @staticmethod
    def list_insert(lst, index, item):
        i = list_index(index, len(lst) + 1, False)
        if i:
            lst.insert(i - 1, item)

    @staticmethod
    def list_replace(lst, index, item):
        i = list_index(index, len(lst), False)
        if i:
            lst[i - 1] = item

    @staticmethod
    def list_item(lst, index):
        i = list_index(index, len(lst), False)
        return lst[i - 1] if i else ''

    @staticmethod
    def list_index_of(lst, item):
        for i, value in enumerate(lst):
            if S.eq(value, item):
                return float(i + 1)
        return 0.0

    @staticmethod
    def list_contains(lst, item):
        return S.list_index_of(lst, item) != 0

    @staticmethod
    def list_contents(lst):
        parts = [S.str(item) for item in lst]
        single = all(len(p) == 1 for p in parts)
        return ('' if single else ' ').join(parts)

    @staticmethod
    def repeat_count(value):
        """How many times "repeat" goes round: Scratch rounds halves up."""
        n = S.num(value)
        if not math.isfinite(n):
            return 0 if n < 0 else 10 ** 9
        return max(0, int(math.floor(n + 0.5)))


NUMBER = re.compile(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?')


def js_parse_number(text):
    """JavaScript's Number(text): what Scratch reads a typed value as, or NaN."""
    t = text.strip(' \t\n\r\x0b\x0c\xa0\ufeff')
    if t == '':
        return 0.0
    if NUMBER.fullmatch(t):
        return float(t)
    if t in ('Infinity', '+Infinity'):
        return math.inf
    if t == '-Infinity':
        return -math.inf
    low = t[:2].lower()
    try:
        if low == '0x':
            return float(int(t[2:], 16))
        if low == '0b':
            return float(int(t[2:], 2))
        if low == '0o':
            return float(int(t[2:], 8))
    except ValueError:
        pass
    return math.nan


def maybe_number(value):
    """The number Scratch compares a value as, or None when it is compared as text."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value) if value == value else None
    text = str(value)
    if text.strip() == '':
        return None
    n = js_parse_number(text)
    return None if n != n else n


def is_int(value):
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return value != value or float(value).is_integer()
    return '.' not in str(value)


def list_index(index, length, accept_all):
    if isinstance(index, str):
        if index == 'all':
            return 'all' if accept_all else 0
        if index == 'last':
            return length if length > 0 else 0
        if index in ('random', 'any'):
            return random.randint(1, length) if length > 0 else 0
    n = S.num(index)
    if not math.isfinite(n):
        return 0
    i = int(math.floor(n))
    if i < 1 or i > length:
        return 0
    return i


def js_number(n):
    """A number written as JavaScript writes it: 5 not 5.0, 1e+21, 1e-7, Infinity."""
    if n != n:
        return 'NaN'
    if math.isinf(n):
        return 'Infinity' if n > 0 else '-Infinity'
    if n == 0:
        return '0'
    if n.is_integer() and abs(n) < 9007199254740992:
        return str(int(n))
    text = repr(n)
    sign = '-' if text.startswith('-') else ''
    text = text.lstrip('-')
    if 'e' in text:
        mantissa, exp = text.split('e')
        exp = int(exp)
    else:
        mantissa, exp = text, 0
    if '.' in mantissa:
        whole, frac = mantissa.split('.')
    else:
        whole, frac = mantissa, ''
    digits = (whole + frac).lstrip('0')
    point = len(whole) + exp - (len(whole + frac) - len((whole + frac).lstrip('0')))
    digits = digits.rstrip('0') or '0'
    k = len(digits)
    if k <= point <= 21:
        return sign + digits + '0' * (point - k)
    if 0 < point <= 21:
        return sign + digits[:point] + '.' + digits[point:]
    if -6 < point <= 0:
        return sign + '0.' + '0' * (-point) + digits
    e = point - 1
    exp_text = ('+' if e >= 0 else '-') + str(abs(e))
    if k == 1:
        return sign + digits + 'e' + exp_text
    return sign + digits[0] + '.' + digits[1:] + 'e' + exp_text


def limit_precision(coordinate):
    rounded = round(coordinate)
    return float(rounded) if abs(coordinate - rounded) < 1e-9 else coordinate


def wrap_clamp(value, low, high):
    span = high - low + 1
    return value - math.floor((value - low) / span) * span


def clamp(value, low, high):
    return min(max(value, low), high)


def hsv_to_rgb(h, s, v):
    h = (h % 360 + 360) % 360
    c = v * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = v - c
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return int(round((r + m) * 255)), int(round((g + m) * 255)), int(round((b + m) * 255))


def rgb_to_hsv(r, g, b):
    r, g, b = r / 255, g / 255, b / 255
    high, low = max(r, g, b), min(r, g, b)
    d = high - low
    h = 0.0
    if d:
        if high == r:
            h = ((g - b) / d) % 6
        elif high == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    return h, (0 if high == 0 else d / high), high


def color_to_rgba(value):
    if isinstance(value, str) and value.startswith('#'):
        hexa = value[1:]
        if len(hexa) == 3:
            hexa = ''.join(c + c for c in hexa)
        try:
            n = int(hexa[:6], 16)
        except ValueError:
            n = 0
        return (n >> 16) & 255, (n >> 8) & 255, n & 255, 255
    n = int(S.num(value)) & 0xFFFFFFFF
    a = (n >> 24) & 255
    return (n >> 16) & 255, (n >> 8) & 255, n & 255, 255 if a == 0 else a


# --- the engine -----------------------------------------------------------------

KEY_NAMES = {pygame.K_SPACE: 'space', pygame.K_UP: 'up arrow', pygame.K_DOWN: 'down arrow',
             pygame.K_LEFT: 'left arrow', pygame.K_RIGHT: 'right arrow', pygame.K_RETURN: 'enter'}

# Hats that start again from the top when started while running.
RESTARTS = {'flag': True, 'key': False, 'click': True, 'stage_click': True, 'receive': True,
            'backdrop': False, 'greater': False, 'clone': False}

# What a script yields to wait for the next frame, as Scratch's volume and
# sound effect blocks do.
NEXT_FRAME = object()


def as_generator(fn, *args):
    """A script as a generator, even when it never yields.

    A script with no loop or wait is a plain function. It still runs on its turn,
    not the moment it is started, so it is wrapped rather than called now.
    """
    if inspect.isgeneratorfunction(fn):
        return fn(*args)

    def run():
        fn(*args)
        return
        yield
    return run()


def custom_block(fn):
    """Marks a custom block: callable with "yield from" whether or not it waits."""
    if inspect.isgeneratorfunction(fn):
        return fn

    def runner(*args):
        fn(*args)
        return
        yield
    runner.__name__ = fn.__name__
    return runner


class Hat:
    def __init__(self, kind, fn, matches=None, menu=None, value=None):
        self.kind = kind
        self.fn = fn
        self.matches = matches or (lambda _: True)
        self.menu = menu
        self.value = value


class Thread:
    def __init__(self, target, hat):
        self.target = target
        self.hat = hat
        self.gen = as_generator(hat.fn, target)
        self.done = False
        self.sleeping = False


class Game:
    def __init__(self, width=480, height=360, framerate=30, fencing=True, max_clones=300, title='Scratch game'):
        self.width = width
        self.height = height
        self.framerate = framerate
        self.fencing = fencing
        self.max_clones = max_clones
        self.title = title
        self.globals = {}
        self.global_lists = {}
        self.stage = None
        self.layers = []
        self.threads = []
        self.keys = set()
        self.mouse_x = 0.0
        self.mouse_y = 0.0
        self.mouse_is_down = False
        self.answer = ''
        self.username = ''
        self.redraw = False
        self.clone_count = 0
        self.timer_start = 0.0
        self.virtual_time = None
        self.edge_state = {}
        self.monitors = []
        self.questions = []
        self.prompt = None
        self.current = None
        self.counter = 0
        self.screen = None
        self.pen = None
        self.sound_on = True
        self.NEXT_FRAME = NEXT_FRAME
        pygame.init()
        try:
            pygame.mixer.init()
        except pygame.error:
            self.sound_on = False
        self.font = pygame.font.SysFont('arial,helvetica,sans', 14)
        self.small_font = pygame.font.SysFont('arial,helvetica,sans', 12, bold=True)
        self.folder = os.path.dirname(os.path.abspath(inspect.stack()[1].filename))

    # -- time --
    def now(self):
        return self.virtual_time if self.virtual_time is not None else time.perf_counter()

    @property
    def timer(self):
        return self.now() - self.timer_start

    def reset_timer(self):
        self.timer_start = self.now()

    # -- making the project --
    def add_stage(self, **spec):
        self.stage = Target(self, spec, True)
        self.globals.update(spec.get('variables', {}))
        for name, items in spec.get('lists', {}).items():
            self.global_lists[name] = list(items)
        self.stage.vars = self.globals
        self.stage.lists = self.global_lists
        return self.stage

    def add_sprite(self, **spec):
        sprite = Target(self, spec, False)
        sprite.vars = dict(spec.get('variables', {}))
        sprite.lists = {name: list(items) for name, items in spec.get('lists', {}).items()}
        self.layers.append(sprite)
        return sprite

    def sprite(self, name):
        for t in self.layers:
            if t.is_original and t.name == name:
                return t
        return None

    def all_targets(self):
        return [self.stage] + self.layers

    # -- threads --
    def start_hats(self, kind, match=None, only=None):
        """Start the scripts with this hat, topmost sprite first, like Scratch."""
        started = []
        for target in reversed(self.all_targets()):
            if only is not None and target is not only:
                continue
            for hat in target.hats:
                if hat.kind != kind or (match is not None and not hat.matches(match)):
                    continue
                running = next((t for t in self.threads if t.target is target and t.hat is hat and not t.done), None)
                if running:
                    if not RESTARTS[kind]:
                        continue
                    running.gen = as_generator(hat.fn, target)
                    started.append(running)
                    continue
                thread = Thread(target, hat)
                self.threads.append(thread)
                started.append(thread)
        return started

    def green_flag(self):
        self.stop_all()
        self.reset_timer()
        self.start_hats('flag')

    def stop_all(self):
        for t in self.threads:
            t.done = True
        self.threads = []
        for target in list(self.layers):
            if not target.is_original:
                target.remove_clone()
        for target in self.all_targets():
            target.clear_effects()
            target.bubble = None
            target.sound_effects = {'pitch': 0.0, 'pan': 0.0}
        self.stop_all_sounds()
        self.questions = []
        self.prompt = None
        self.redraw = True

    def broadcast(self, name):
        return self.start_hats('receive', S.str(name))

    def broadcast_and_wait(self, name):
        started = self.broadcast(name)
        runs = [(t, t.gen) for t in started]
        while any(not t.done and t.gen is gen for t, gen in runs):
            yield

    def wait(self, seconds):
        end = self.now() + max(0.0, S.num(seconds))
        # Scratch asks for the stage to be drawn when a wait starts, which ends the frame.
        self.redraw = True
        yield
        while self.now() < end:
            yield

    def step(self):
        """One frame: edge hats, then every script's turns, then the picture."""
        self.check_edge_hats()
        self.redraw = False
        for thread in self.threads:
            thread.sleeping = False
        budget = 0.75 / self.framerate
        start = time.perf_counter()
        passes = 0
        while True:
            ran = False
            i = 0
            while i < len(self.threads):
                thread = self.threads[i]
                i += 1
                if thread.done or thread.sleeping:
                    continue
                if thread.target.removed:
                    thread.done = True
                    continue
                ran = True
                self.current = thread
                try:
                    value = next(thread.gen)
                    if value is NEXT_FRAME:
                        thread.sleeping = True
                except StopIteration:
                    thread.done = True
                except Exception as error:  # A script that breaks stops, as in Scratch.
                    thread.done = True
                    print(f'A script in {thread.target.name} stopped with an error: {error!r}')
            self.current = None
            self.threads = [t for t in self.threads if not t.done]
            passes += 1
            if (not ran or not self.threads or self.redraw or time.perf_counter() - start >= budget
                    or passes >= 10000):
                break
        if self.screen is not None:
            self.render()

    def check_edge_hats(self):
        for target in self.all_targets():
            for hat in target.hats:
                if hat.kind != 'greater':
                    continue
                value = self.timer if hat.menu == 'TIMER' else -1
                now = value > S.num(hat.value(target))
                before = self.edge_state.get(id(hat), False)
                self.edge_state[id(hat)] = now
                if now and not before:
                    self.threads.append(Thread(target, hat))

    # -- the backdrop --
    @property
    def backdrop_number(self):
        return float(self.stage.costume_index + 1)

    @property
    def backdrop_name(self):
        return self.stage.costumes[self.stage.costume_index].name

    def switch_backdrop(self, value):
        stage = self.stage
        text = S.str(value)
        count = len(stage.costumes)
        if text == 'next backdrop':
            stage.set_costume(stage.costume_index + 1)
        elif text == 'previous backdrop':
            stage.set_costume(stage.costume_index - 1)
        elif text == 'random backdrop':
            if count > 1:
                pick = random.randrange(count - 1)
                if pick >= stage.costume_index:
                    pick += 1
                stage.set_costume(pick)
        else:
            stage.switch_costume(value)
        return self.start_hats('backdrop', self.backdrop_name)

    def switch_backdrop_and_wait(self, value):
        started = self.switch_backdrop(value)
        runs = [(t, t.gen) for t in started]
        while any(not t.done and t.gen is gen for t, gen in runs):
            yield

    # -- sensing --
    def key_pressed(self, key):
        k = S.str(key).lower()
        if k == 'any':
            return bool(self.keys)
        return k in self.keys

    @property
    def mouse_down(self):
        return self.mouse_is_down

    @property
    def mouse_x_position(self):
        return float(round(self.mouse_x))

    @property
    def mouse_y_position(self):
        return float(round(self.mouse_y))

    @property
    def loudness(self):
        return -1.0

    def current_time(self, what):
        t = time.localtime()
        return float({'year': t.tm_year, 'month': t.tm_mon, 'date': t.tm_mday,
                      'dayofweek': (t.tm_wday + 1) % 7 + 1, 'hour': t.tm_hour, 'minute': t.tm_min,
                      'second': t.tm_sec}.get(S.str(what).lower(), 0))

    def days_since_2000(self):
        return (time.time() - 946684800) / 86400

    def property_of(self, prop, object_name):
        if object_name == '_stage_':
            if prop == 'backdrop #':
                return self.backdrop_number
            if prop == 'backdrop name':
                return self.backdrop_name
            if prop == 'volume':
                return self.stage.volume
            return self.globals.get(prop, 0.0)
        target = self.sprite(S.str(object_name))
        if target is None:
            return 0.0
        values = {'x position': target.x_position, 'y position': target.y_position,
                  'direction': target.direction, 'costume #': float(target.costume_index + 1),
                  'costume name': target.costume_name, 'size': target.size, 'volume': target.volume}
        if prop in values:
            return values[prop]
        return target.vars.get(prop, 0.0)

    # -- ask and answer --
    def ask(self, target, question):
        entry = {'target': target, 'question': S.str(question), 'answered': False}
        self.questions.append(entry)
        if len(self.questions) == 1:
            self.show_question(entry)
        while not entry['answered']:
            yield

    def show_question(self, entry):
        target = entry['target']
        visible_sprite = not target.is_stage and target.visible
        if visible_sprite:
            target.set_bubble('say', entry['question'])
        self.prompt = {'question': '' if visible_sprite else entry['question'], 'text': '', 'entry': entry,
                       'sprite': target if visible_sprite else None}

    def submit_answer(self):
        prompt = self.prompt
        if not prompt:
            return
        self.prompt = None
        self.answer = prompt['text']
        prompt['entry']['answered'] = True
        if prompt['sprite'] is not None:
            prompt['sprite'].set_bubble('say', '')
        self.questions.pop(0)
        if self.questions:
            self.show_question(self.questions[0])

    # -- sounds --
    def stop_all_sounds(self):
        for target in self.all_targets():
            target.stop_sounds()

    # -- the pen --
    def pen_clear(self):
        if self.pen is not None:
            self.pen.fill((0, 0, 0, 0))
        self.redraw = True

    # -- readouts --
    def show_monitor(self, monitor_id, visible):
        for m in self.monitors:
            if m['id'] == monitor_id:
                m['visible'] = visible

    def add_monitor(self, **monitor):
        self.monitors.append(monitor)

    # -- running --
    def load(self, test=False):
        """Open the window (none in a test) and load the costumes and sounds."""
        if test:
            os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
            self.virtual_time = 0.0
            self.sound_on = False
            pygame.display.set_mode((1, 1))
        else:
            pygame.display.set_caption(self.title)
            self.screen = pygame.display.set_mode((self.width, self.height), pygame.SCALED | pygame.RESIZABLE)
        self.pen = pygame.Surface((self.width, self.height), pygame.SRCALPHA)
        for target in self.all_targets():
            for costume in target.costumes:
                costume.load(self)
            for sound in target.sounds:
                sound.load(self)

    def run(self):
        """Open the window and play: the game starts as if the green flag were clicked."""
        self.load()
        clock = pygame.time.Clock()
        self.green_flag()
        running = True
        while running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                else:
                    self.handle(event)
            self.step()
            pygame.display.flip()
            clock.tick(self.framerate)
        pygame.quit()

    def handle(self, event):
        if event.type == pygame.KEYDOWN:
            if self.prompt is not None:
                if event.key == pygame.K_RETURN:
                    self.submit_answer()
                elif event.key == pygame.K_BACKSPACE:
                    self.prompt['text'] = self.prompt['text'][:-1]
                elif event.unicode and event.unicode.isprintable():
                    self.prompt['text'] += event.unicode
                return
            if event.key == pygame.K_F5 or (event.key == pygame.K_g and event.mod & pygame.KMOD_CTRL):
                self.green_flag()
                return
            if event.key == pygame.K_ESCAPE:
                self.stop_all()
                return
            name = key_name(event)
            if name:
                self.keys.add(name)
                self.start_hats('key', name)
        elif event.type == pygame.KEYUP:
            name = key_name(event)
            self.keys.discard(name)
        elif event.type == pygame.MOUSEMOTION:
            self.mouse_x, self.mouse_y = self.to_stage(event.pos)
            if getattr(self, 'dragging', None):
                target, dx, dy = self.dragging
                target.set_xy(self.mouse_x - dx, self.mouse_y - dy, force=True)
        elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            self.mouse_x, self.mouse_y = self.to_stage(event.pos)
            self.mouse_is_down = True
            for target in reversed(self.layers):
                if target.removed or not target.visible:
                    continue
                if self.hit(target, self.mouse_x, self.mouse_y):
                    if target.draggable:
                        self.dragging = (target, self.mouse_x - target.x, self.mouse_y - target.y)
                    self.start_hats('click', None, target)
                    return
            self.start_hats('stage_click')
        elif event.type == pygame.MOUSEBUTTONUP and event.button == 1:
            self.mouse_is_down = False
            self.dragging = None

    def to_stage(self, pos):
        x = pos[0] - self.width / 2
        y = self.height / 2 - pos[1]
        return clamp(x, -self.width / 2, self.width / 2), clamp(y, -self.height / 2, self.height / 2)

    # -- for tests: frames on a clock that moves one frame at a time --
    def step_frames(self, count):
        for _ in range(count):
            self.step()
            if self.virtual_time is not None:
                self.virtual_time += 1 / self.framerate

    def snapshot(self):
        out = {'globals': dict(self.globals), 'lists': {k: list(v) for k, v in self.global_lists.items()},
               'sprites': {}, 'backdrop': self.backdrop_name}
        for t in self.layers:
            if not t.is_original:
                continue
            out['sprites'][t.name] = {
                'x': t.x_position, 'y': t.y_position, 'direction': t.direction, 'size': t.size,
                'visible': t.visible, 'costume': t.costume_name, 'variables': dict(t.vars),
                'clones': sum(1 for c in self.layers if not c.is_original and c.original is t and not c.removed)}
        return out

    # -- touching: Scratch's point by point test --
    def hit(self, target, x, y):
        """Whether a stage point lands on a drawn pixel of the target's costume, as Scratch samples it."""
        c = target.costume()
        if c is None or c.mask is None:
            return False
        angle = math.radians(target.draw_angle())
        cos, sin = math.cos(angle), math.sin(angle)
        dx, dy = x - target.x, y - target.y
        px = (dx * cos - dy * sin) / target.scale_x()
        py = (dx * sin + dy * cos) / (target.size / 100)
        u = (c.center_x + px) / c.width
        v = (c.center_y - py) / c.height
        w, h = c.mask_size
        sx = math.floor(u * (w - 1))
        sy = math.floor(v * (h - 1))

        def at(ax, ay):
            return 0 <= ax < w and 0 <= ay < h and c.mask.get_at((ax, ay))
        plain = target.size == 100 and abs(target.draw_angle() % 90) < 1e-9 and target.scale_x() > 0
        if plain:
            return bool(at(sx, sy))
        return bool(at(sx, sy) or at(sx + 1, sy) or at(sx, sy + 1) or at(sx + 1, sy + 1))

    def touches(self, a, b):
        ba, bb = a.bounds(), b.bounds()
        if ba is None or bb is None:
            return False
        left = max(math.floor(ba[0]), math.floor(-self.width / 2), math.floor(bb[0]))
        right = min(math.ceil(ba[1]), math.ceil(self.width / 2), math.ceil(bb[1]))
        bottom = max(math.floor(ba[2]), math.floor(-self.height / 2), math.floor(bb[2]))
        top = min(math.ceil(ba[3]), math.ceil(self.height / 2), math.ceil(bb[3]))
        if left > right or bottom > top:
            return False
        for x in range(left, right + 1):
            for y in range(bottom, top + 1):
                if self.hit(a, x, y) and self.hit(b, x, y):
                    return True
        return False

    # -- drawing --
    def render(self):
        screen = self.screen
        screen.fill((255, 255, 255))
        self.draw_target(screen, self.stage)
        screen.blit(self.pen, (0, 0))
        for target in self.layers:
            if target.visible:
                self.draw_target(screen, target)
        for target in self.layers:
            if target.visible and target.bubble:
                self.draw_bubble(screen, target)
        self.draw_monitors(screen)
        if self.prompt is not None:
            self.draw_prompt(screen)

    def draw_target(self, surface, target, plain=False):
        c = target.costume()
        if c is None or c.image is None:
            return
        if target.is_stage:
            surface.blit(c.scaled(1.0), (self.width / 2 - c.center_x, self.height / 2 - c.center_y))
            return
        image, offset = c.transformed(target.size / 100, target.draw_angle(), target.scale_x() < 0)
        if not plain:
            ghost = target.effects.get('ghost', 0)
            brightness = target.effects.get('brightness', 0)
            if ghost or brightness:
                image = image.copy()
                if brightness > 0:
                    v = int(255 * brightness / 100)
                    image.fill((v, v, v, 0), special_flags=pygame.BLEND_RGBA_ADD)
                elif brightness < 0:
                    v = int(255 * -brightness / 100)
                    image.fill((v, v, v, 0), special_flags=pygame.BLEND_RGBA_SUB)
                if ghost:
                    image.fill((255, 255, 255, int(255 * (1 - ghost / 100))), special_flags=pygame.BLEND_RGBA_MULT)
        x = self.width / 2 + target.x + offset[0]
        y = self.height / 2 - target.y + offset[1]
        surface.blit(image, (round(x), round(y)))

    def draw_bubble(self, surface, target):
        b = target.bounds()
        if b is None:
            return
        words = target.bubble['text'].split(' ')
        lines, line = [], ''
        for word in words:
            test = f'{line} {word}' if line else word
            if self.font.size(test)[0] > 170 and line:
                lines.append(line)
                line = word
            else:
                line = test
        lines.append(line)
        width = max(50, min(170, max(self.font.size(l)[0] for l in lines))) + 20
        height = len(lines) * 17 + 14
        x = self.width / 2 + b[1]
        if x + width > self.width:
            x = max(0, self.width / 2 + b[0] - width)
        y = max(0, self.height / 2 - b[3] - height - 8)
        rect = pygame.Rect(int(x), int(y), int(width), int(height))
        pygame.draw.rect(surface, (255, 255, 255), rect, border_radius=12)
        pygame.draw.rect(surface, (200, 200, 200), rect, width=2, border_radius=12)
        for i, text in enumerate(lines):
            surface.blit(self.font.render(text, True, (87, 94, 117)), (rect.x + 10, rect.y + 7 + i * 17))

    def draw_monitors(self, surface):
        for m in self.monitors:
            if not m.get('visible'):
                continue
            value = m['read']()
            if m.get('mode') == 'list':
                items = value if isinstance(value, list) else []
                rect = pygame.Rect(m['x'], m['y'], m.get('width') or 100, m.get('height') or 200)
                pygame.draw.rect(surface, (230, 240, 255), rect, border_radius=4)
                pygame.draw.rect(surface, (198, 205, 212), rect, width=1, border_radius=4)
                surface.blit(self.small_font.render(m['label'], True, (87, 94, 117)), (rect.x + 4, rect.y + 2))
                for i, item in enumerate(items[: max(0, (rect.height - 36) // 16)]):
                    text = self.font.render(f'{i + 1} {S.str(item)}', True, (87, 94, 117))
                    surface.blit(text, (rect.x + 4, rect.y + 18 + i * 16))
                footer = self.small_font.render(f'length {len(items)}', True, (87, 94, 117))
                surface.blit(footer, (rect.x + 4, rect.bottom - 16))
                continue
            shown = S.str(round(value, 6) if isinstance(value, float) else value)
            label = self.small_font.render(m['label'], True, (87, 94, 117))
            text = self.small_font.render(shown, True, (255, 255, 255))
            large = m.get('mode') == 'large'
            w = (0 if large else label.get_width() + 8) + max(text.get_width() + 10, 30) + 6
            rect = pygame.Rect(m['x'], m['y'], w, 22)
            if not large:
                pygame.draw.rect(surface, (230, 240, 255), rect, border_radius=4)
                pygame.draw.rect(surface, (198, 205, 212), rect, width=1, border_radius=4)
                surface.blit(label, (rect.x + 4, rect.y + 4))
            value_rect = pygame.Rect(rect.right - max(text.get_width() + 10, 30) - 3, rect.y + 3,
                                     max(text.get_width() + 10, 30), 16)
            pygame.draw.rect(surface, (255, 140, 26), value_rect, border_radius=4)
            surface.blit(text, (value_rect.centerx - text.get_width() // 2, value_rect.y + 1))

    def draw_prompt(self, surface):
        rect = pygame.Rect(10, self.height - 60, self.width - 20, 50)
        pygame.draw.rect(surface, (255, 255, 255), rect, border_radius=8)
        pygame.draw.rect(surface, (200, 200, 200), rect, width=2, border_radius=8)
        if self.prompt['question']:
            surface.blit(self.small_font.render(self.prompt['question'], True, (87, 94, 117)), (rect.x + 8, rect.y + 4))
        box = pygame.Rect(rect.x + 8, rect.y + 22, rect.width - 16, 22)
        pygame.draw.rect(surface, (198, 205, 212), box, width=1, border_radius=10)
        surface.blit(self.font.render(self.prompt['text'] + '|', True, (87, 94, 117)), (box.x + 8, box.y + 3))


def key_name(event):
    if event.key in KEY_NAMES:
        return KEY_NAMES[event.key]
    if event.unicode and len(event.unicode) == 1 and event.unicode.isprintable():
        return event.unicode.lower()
    name = pygame.key.name(event.key)
    return name.lower() if len(name) == 1 else ''


# --- a sprite or the stage ------------------------------------------------------

class Target:
    def __init__(self, game, spec, is_stage):
        self.game = game
        self.name = spec.get('name', 'Sprite')
        self.is_stage = is_stage
        self.is_original = True
        self.original = self
        self.removed = False
        self.hats = []
        self.x = float(spec.get('x', 0))
        self.y = float(spec.get('y', 0))
        self.direction = float(spec.get('direction', 90))
        self.size = float(spec.get('size', 100))
        self.visible = True if is_stage else spec.get('visible', True)
        self.rotation_style = spec.get('rotation_style', 'all around')
        self.draggable = spec.get('draggable', False)
        self.volume = float(spec.get('volume', 100))
        self.effects = {'color': 0.0, 'fisheye': 0.0, 'whirl': 0.0, 'pixelate': 0.0, 'mosaic': 0.0,
                        'brightness': 0.0, 'ghost': 0.0}
        self.sound_effects = {'pitch': 0.0, 'pan': 0.0}
        self.bubble = None
        self.costumes = [Costume(c) for c in spec.get('costumes', [])]
        self.costume_index = min(spec.get('costume', 0), max(0, len(self.costumes) - 1))
        self.sounds = [Sound(s) for s in spec.get('sounds', [])]
        self.playing = []
        self.pen_state = {'down': False, 'color': 66.66, 'saturation': 100.0, 'brightness': 100.0,
                          'transparency': 0.0, 'size': 1.0}
        self.vars = {}
        self.lists = {}

    # -- scripts (used as decorators in main.py) --
    def _on(self, kind, fn, **extra):
        self.hats.append(Hat(kind, fn, **extra))
        return fn

    def when_flag_clicked(self, fn):
        return self._on('flag', fn)

    def when_key_pressed(self, key):
        k = S.str(key).lower()
        return lambda fn: self._on('key', fn, matches=lambda pressed: k == 'any' or pressed == k)

    def when_this_sprite_clicked(self, fn):
        return self._on('click', fn)

    def when_stage_clicked(self, fn):
        return self._on('stage_click', fn)

    def when_i_receive(self, message):
        m = S.str(message).lower()
        return lambda fn: self._on('receive', fn, matches=lambda sent: S.str(sent).lower() == m)

    def when_backdrop_switches_to(self, backdrop):
        b = S.str(backdrop).lower()
        return lambda fn: self._on('backdrop', fn, matches=lambda name: S.str(name).lower() == b)

    def when_greater_than(self, menu, value):
        return lambda fn: self._on('greater', fn, menu=S.str(menu).upper(), value=value)

    def when_i_start_as_a_clone(self, fn):
        return self._on('clone', fn)

    def stop_other_scripts(self):
        me = self.game.current
        for t in self.game.threads:
            if t.target is self and t is not me:
                t.done = True

    # -- motion --
    def set_xy(self, x, y, force=False):
        if self.is_stage:
            return
        old_x, old_y = self.x, self.y
        x, y = S.num(x), S.num(y)
        if self.game.fencing and not force:
            x, y = self.fenced_position(x, y)
        self.x, self.y = x, y
        if self.pen_state['down']:
            self.draw_pen_line(old_x, old_y, x, y)
        if self.visible:
            self.game.redraw = True

    def go_to(self, x, y):
        self.set_xy(x, y)

    def change_x(self, dx):
        self.set_xy(self.x + S.num(dx), self.y)

    def change_y(self, dy):
        self.set_xy(self.x, self.y + S.num(dy))

    def set_x(self, x):
        self.set_xy(x, self.y)

    def set_y(self, y):
        self.set_xy(self.x, y)

    def move_steps(self, steps):
        radians = math.radians(90 - self.direction)
        n = S.num(steps)
        self.set_xy(self.x + n * math.cos(radians), self.y + n * math.sin(radians))

    def set_direction(self, direction):
        d = S.num(direction)
        if not math.isfinite(d):
            return
        self.direction = wrap_clamp(d, -179, 180)
        if self.visible:
            self.game.redraw = True

    def turn_right(self, degrees):
        self.set_direction(self.direction + S.num(degrees))

    def turn_left(self, degrees):
        self.set_direction(self.direction - S.num(degrees))

    def position_of(self, name):
        what = S.str(name)
        if what == '_mouse_':
            return self.game.mouse_x_position, self.game.mouse_y_position
        if what == '_random_':
            return (float(round(self.game.width * (random.random() - 0.5))),
                    float(round(self.game.height * (random.random() - 0.5))))
        other = self.game.sprite(what)
        return (other.x, other.y) if other else None

    def go_to_target(self, name):
        at = self.position_of(name)
        if at:
            self.set_xy(at[0], at[1])

    def point_towards(self, name):
        what = S.str(name)
        if what == '_random_':
            self.set_direction(round(random.random() * 360) - 180)
            return
        at = self.position_of(what)
        if not at:
            return
        self.set_direction(90 - math.degrees(math.atan2(at[1] - self.y, at[0] - self.x)))

    def glide_to(self, seconds, x, y):
        duration = S.num(seconds)
        start_x, start_y = self.x, self.y
        end_x, end_y = S.num(x), S.num(y)
        if duration <= 0:
            self.set_xy(end_x, end_y)
            return
        start = self.game.now()
        yield
        while True:
            t = (self.game.now() - start) / duration
            if t >= 1:
                self.set_xy(end_x, end_y)
                return
            self.set_xy(start_x + (end_x - start_x) * t, start_y + (end_y - start_y) * t)
            yield

    def glide_to_target(self, seconds, name):
        at = self.position_of(name)
        if at:
            yield from self.glide_to(seconds, at[0], at[1])

    def set_rotation_style(self, style):
        self.rotation_style = S.str(style)
        if self.visible:
            self.game.redraw = True

    @property
    def x_position(self):
        return limit_precision(self.x)

    @property
    def y_position(self):
        return limit_precision(self.y)

    def bounce_on_edge(self):
        b = self.bounds()
        if b is None:
            return
        w, h = self.game.width / 2, self.game.height / 2
        distances = [('left', max(0, w + b[0])), ('top', max(0, h - b[3])), ('right', max(0, w - b[1])),
                     ('bottom', max(0, h + b[2]))]
        nearest, smallest = min(distances, key=lambda d: d[1])
        if smallest > 0:
            return
        radians = math.radians(90 - self.direction)
        dx, dy = math.cos(radians), -math.sin(radians)
        if nearest == 'left':
            dx = max(0.2, abs(dx))
        elif nearest == 'top':
            dy = max(0.2, abs(dy))
        elif nearest == 'right':
            dx = -max(0.2, abs(dx))
        else:
            dy = -max(0.2, abs(dy))
        self.set_direction(math.degrees(math.atan2(dy, dx)) + 90)
        x, y = self.keep_in_fence(self.x, self.y)
        self.set_xy(x, y, force=True)

    # -- the shape on the stage --
    def costume(self):
        return self.costumes[self.costume_index] if self.costumes else None

    def scale_x(self):
        flip = -1 if self.rotation_style == 'left-right' and self.direction < 0 else 1
        return flip * self.size / 100

    def draw_angle(self):
        return self.direction - 90 if self.rotation_style == 'all around' else 0.0

    def bounds(self):
        """(left, right, bottom, top) of the drawn part, measured as Scratch does."""
        c = self.costume()
        if c is None or c.box is None:
            return None
        left, top, right, bottom = c.box
        sx, sy = self.scale_x(), self.size / 100
        angle = math.radians(self.draw_angle())
        cos, sin = math.cos(angle), math.sin(angle)
        xs, ys = [], []
        for px, py in ((left, top), (right, top), (right, bottom), (left, bottom)):
            ux = (px - c.center_x) * sx
            uy = (c.center_y - py) * sy
            xs.append(self.x + ux * cos + uy * sin)
            ys.append(self.y - ux * sin + uy * cos)
        return min(xs), max(xs), min(ys), max(ys)

    def fenced_position(self, x, y):
        """Where a move to x, y ends with fencing on: Scratch keeps a sliver (up to 15 steps) on the stage."""
        b = self.bounds()
        if b is None:
            return x, y
        dx, dy = x - self.x, y - self.y
        inset = math.floor(min(b[1] - b[0], b[3] - b[2]) / 2)
        sx = self.game.width / 2 - min(15, inset)
        sy = self.game.height / 2 - min(15, inset)
        if b[1] + dx < -sx:
            x = math.ceil(self.x - (sx + b[1]))
        elif b[0] + dx > sx:
            x = math.floor(self.x + (sx - b[0]))
        if b[3] + dy < -sy:
            y = math.ceil(self.y - (sy + b[3]))
        elif b[2] + dy > sy:
            y = math.floor(self.y + (sy - b[2]))
        return float(x), float(y)

    def keep_in_fence(self, x, y):
        """The whole sprite back inside the stage, as "if on edge, bounce" puts it."""
        b = self.bounds()
        if b is None:
            return x, y
        left, right = b[0] + x - self.x, b[1] + x - self.x
        bottom, top = b[2] + y - self.y, b[3] + y - self.y
        w, h = self.game.width / 2, self.game.height / 2
        dx = dy = 0.0
        if left < -w:
            dx += -w - left
        if right > w:
            dx += w - right
        if top > h:
            dy += h - top
        if bottom < -h:
            dy += -h - bottom
        return x + dx, y + dy

    # -- looks --
    def set_costume(self, index):
        if not self.costumes:
            return
        self.costume_index = int(wrap_clamp(round(index), 0, len(self.costumes) - 1))
        if self.visible:
            self.game.redraw = True

    def switch_costume(self, value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            self.set_costume(value - 1)
            return
        text = S.str(value)
        for i, c in enumerate(self.costumes):
            if c.name == text:
                self.set_costume(i)
                return
        if not self.is_stage and text == 'next costume':
            self.set_costume(self.costume_index + 1)
        elif not self.is_stage and text == 'previous costume':
            self.set_costume(self.costume_index - 1)
        elif text.strip() and maybe_number(text) is not None:
            self.set_costume(maybe_number(text) - 1)

    def next_costume(self):
        self.set_costume(self.costume_index + 1)

    @property
    def costume_number(self):
        return float(self.costume_index + 1)

    @property
    def costume_name(self):
        c = self.costume()
        return c.name if c else ''

    def set_size(self, size):
        s = S.num(size)
        c = self.costume()
        if self.game.fencing and c is not None and c.width:
            min_scale = min(1, max(5 / c.width, 5 / c.height))
            max_scale = min(1.5 * self.game.width / c.width, 1.5 * self.game.height / c.height)
            s = clamp(s / 100, min_scale, max_scale) * 100
        self.size = s
        if self.visible:
            self.game.redraw = True

    def change_size(self, by):
        self.set_size(self.size + S.num(by))

    def set_effect(self, name, value):
        effect = S.str(name).lower()
        v = S.num(value)
        if effect == 'ghost':
            v = clamp(v, 0, 100)
        if effect == 'brightness':
            v = clamp(v, -100, 100)
        self.effects[effect] = v
        if self.visible:
            self.game.redraw = True

    def change_effect(self, name, by):
        effect = S.str(name).lower()
        self.set_effect(effect, self.effects.get(effect, 0) + S.num(by))

    def clear_effects(self):
        for k in self.effects:
            self.effects[k] = 0.0
        if self.visible:
            self.game.redraw = True

    def show(self):
        self.visible = True
        self.game.redraw = True

    def hide(self):
        self.visible = False
        self.game.redraw = True

    def go_to_layer(self, where):
        layers = self.game.layers
        layers.remove(self)
        if S.str(where) == 'back':
            layers.insert(0, self)
        else:
            layers.append(self)
        self.game.redraw = True

    def change_layer(self, direction, by):
        layers = self.game.layers
        start = layers.index(self)
        step = int(round(S.num(by))) * (-1 if S.str(direction) == 'backward' else 1)
        to = clamp(start + step, 0, len(layers) - 1)
        layers.pop(start)
        layers.insert(to, self)
        self.game.redraw = True

    def set_bubble(self, kind, text):
        message = text
        if isinstance(message, float):
            message = float(f'{message:.2f}')
        message = S.str(message)
        self.bubble = None if message == '' else {'type': kind, 'text': message}
        self.game.redraw = True
        return self.bubble

    def say(self, text):
        self.set_bubble('say', text)

    def think(self, text):
        self.set_bubble('think', text)

    def say_for(self, text, seconds):
        bubble = self.set_bubble('say', text)
        yield from self.game.wait(seconds)
        if self.bubble is bubble:
            self.set_bubble('say', '')

    def think_for(self, text, seconds):
        bubble = self.set_bubble('think', text)
        yield from self.game.wait(seconds)
        if self.bubble is bubble:
            self.set_bubble('think', '')

    def set_drag_mode(self, mode):
        self.draggable = S.str(mode) == 'draggable'

    # -- clones --
    def create_clone(self, name):
        game = self.game
        what = S.str(name)
        source = self if what == '_myself_' else game.sprite(what)
        if source is None or source.is_stage or game.clone_count >= game.max_clones:
            return
        clone = Target.__new__(Target)
        clone.__dict__.update(source.__dict__)
        clone.is_original = False
        clone.original = source.original
        clone.removed = False
        clone.vars = dict(source.vars)
        clone.lists = {k: list(v) for k, v in source.lists.items()}
        clone.effects = dict(source.effects)
        clone.sound_effects = dict(source.sound_effects)
        clone.pen_state = dict(source.pen_state)
        clone.bubble = None
        clone.playing = []
        game.clone_count += 1
        # Just behind the sprite it was made from.
        game.layers.insert(game.layers.index(source), clone)
        game.start_hats('clone', None, clone)
        if clone.visible:
            game.redraw = True

    def delete_clone(self):
        """True when this was a clone and is gone, so its script ends."""
        if self.is_original:
            return False
        self.remove_clone()
        return True

    def remove_clone(self):
        if self.removed:
            return
        self.removed = True
        self.stop_sounds()
        if self in self.game.layers:
            self.game.layers.remove(self)
        self.game.clone_count -= 1
        for t in self.game.threads:
            if t.target is self:
                t.done = True
        self.game.redraw = True

    # -- sensing --
    def touching(self, name):
        what = S.str(name)
        if what == '_mouse_':
            return self.visible and self.game.hit(self, self.game.mouse_x, self.game.mouse_y)
        if what == '_edge_':
            b = self.bounds()
            if b is None:
                return False
            w, h = self.game.width / 2, self.game.height / 2
            return b[0] < -w or b[1] > w or b[3] > h or b[2] < -h
        if not self.visible:
            return False
        for other in self.game.layers:
            if other is self or other.removed or not other.visible or other.original.name != what:
                continue
            if self.game.touches(self, other):
                return True
        return False

    def touching_color(self, color):
        return False

    def distance_to(self, name):
        if self.is_stage:
            return 10000.0
        at = self.position_of(name)
        if not at:
            return 10000.0
        return math.hypot(self.x - at[0], self.y - at[1])

    # -- sounds --
    def sound_index(self, value):
        count = len(self.sounds)
        if not count:
            return -1
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(wrap_clamp(round(value) - 1, 0, count - 1))
        text = S.str(value)
        for i, s in enumerate(self.sounds):
            if s.name == text:
                return i
        n = maybe_number(text)
        if text.strip() and n is not None:
            return int(wrap_clamp(round(n) - 1, 0, count - 1))
        return -1

    def start_sound(self, value):
        index = self.sound_index(value)
        if index < 0:
            return None
        sound = self.sounds[index]
        # The same sound on the same sprite starts again rather than doubling.
        kept = []
        for playing_sound, playing_channel in self.playing:
            if playing_sound is sound:
                playing_channel.stop()
            else:
                kept.append((playing_sound, playing_channel))
        self.playing = kept
        channel = sound.play(self.volume, self.sound_effects)
        if channel is not None:
            self.playing.append((sound, channel))
        return sound

    def play_sound_until_done(self, value):
        sound = self.start_sound(value)
        if sound is None:
            index = self.sound_index(value)
            if index < 0:
                return
            sound = self.sounds[index]
        yield from self.game.wait(sound.duration)

    def stop_sounds(self):
        for _, channel in self.playing:
            channel.stop()
        self.playing = []

    def set_volume(self, value):
        self.volume = clamp(S.num(value), 0, 100)
        for sound, channel in self.playing:
            sound.apply(channel, self.volume, self.sound_effects)

    def change_volume(self, by):
        self.set_volume(self.volume + S.num(by))

    def set_sound_effect(self, name, value):
        effect = S.str(name).lower()
        if effect == 'pitch':
            self.sound_effects['pitch'] = clamp(S.num(value), -360, 360)
        if effect == 'pan':
            self.sound_effects['pan'] = clamp(S.num(value), -100, 100)
        for sound, channel in self.playing:
            sound.apply(channel, self.volume, self.sound_effects)

    def change_sound_effect(self, name, by):
        effect = S.str(name).lower()
        self.set_sound_effect(effect, self.sound_effects.get(effect, 0) + S.num(by))

    def clear_sound_effects(self):
        self.sound_effects = {'pitch': 0.0, 'pan': 0.0}

    # -- the pen --
    def pen_rgba(self):
        p = self.pen_state
        r, g, b = hsv_to_rgb(p['color'] / 100 * 360, p['saturation'] / 100, p['brightness'] / 100)
        return r, g, b, int(round(255 * (1 - p['transparency'] / 100)))

    def pen_down(self):
        self.pen_state['down'] = True
        self.draw_pen_line(self.x, self.y, self.x, self.y)

    def pen_up(self):
        self.pen_state['down'] = False

    def draw_pen_line(self, x1, y1, x2, y2):
        g = self.game
        if g.pen is None:
            return
        color = self.pen_rgba()
        size = self.pen_state['size']
        a = (g.width / 2 + x1, g.height / 2 - y1)
        b = (g.width / 2 + x2, g.height / 2 - y2)
        if size <= 1:
            pygame.draw.line(g.pen, color, a, b, 1)
        else:
            pygame.draw.line(g.pen, color, a, b, max(1, round(size)))
            pygame.draw.circle(g.pen, color, a, size / 2)
            pygame.draw.circle(g.pen, color, b, size / 2)
        g.redraw = True

    def set_pen_color(self, value):
        r, g, b, a = color_to_rgba(value)
        h, s, v = rgb_to_hsv(r, g, b)
        self.pen_state.update(color=h / 360 * 100, saturation=s * 100, brightness=v * 100,
                              transparency=100 * (1 - a / 255))

    def set_pen_param(self, param, value):
        p = S.str(param).lower()
        v = S.num(value)
        if p == 'color':
            self.pen_state['color'] = wrap_clamp(v, 0, 100)
        elif p in ('saturation', 'brightness', 'transparency'):
            self.pen_state[p] = clamp(v, 0, 100)

    def change_pen_param(self, param, by):
        p = S.str(param).lower()
        self.set_pen_param(p, self.pen_state.get(p, 0) + S.num(by))

    def set_pen_size(self, size):
        self.pen_state['size'] = clamp(S.num(size), 1, 1200)

    def change_pen_size(self, by):
        self.set_pen_size(self.pen_state['size'] + S.num(by))

    def stamp(self):
        if self.game.pen is not None:
            self.game.draw_target(self.game.pen, self)
            self.game.redraw = True


# --- pictures and sounds --------------------------------------------------------

class Costume:
    def __init__(self, spec):
        self.name = spec['name']
        self.file = spec['file']
        self.resolution = spec.get('resolution', 1)
        self.raw_center = (spec.get('center_x', 0), spec.get('center_y', 0))
        self.image = None
        self.mask = None
        self.box = None
        self.width = self.height = 1
        self.center_x = self.center_y = 0
        self.cache = {}

    def load(self, game):
        path = os.path.join(game.folder, self.file)
        try:
            image = pygame.image.load(path)
            self.image = image.convert_alpha() if pygame.display.get_surface() else image
        except (pygame.error, FileNotFoundError) as error:
            print(f'Could not load the picture {self.file}: {error}')
            self.image = pygame.Surface((1, 1), pygame.SRCALPHA)
        r = self.resolution
        self.width = self.image.get_width() / r
        self.height = self.image.get_height() / r
        self.center_x = self.raw_center[0] / r
        self.center_y = self.raw_center[1] / r
        self.mask = pygame.mask.from_surface(self.image, 0)
        self.mask_size = self.mask.get_size()
        rects = self.mask.get_bounding_rects()
        if rects:
            box = rects[0].unionall(rects[1:])
            # From the centre of the outermost drawn pixels, as Scratch measures.
            self.box = (box.left / r + 0.5, box.top / r + 0.5, box.right / r - 0.5, box.bottom / r - 0.5)
        else:
            self.box = (self.center_x, self.center_y, self.center_x, self.center_y)

    def scaled(self, scale):
        key = ('scaled', scale)
        if key not in self.cache:
            w = max(1, round(self.image.get_width() * scale / self.resolution))
            h = max(1, round(self.image.get_height() * scale / self.resolution))
            self.cache[key] = pygame.transform.smoothscale(self.image, (w, h))
        return self.cache[key]

    def transformed(self, scale, angle, flip):
        """The picture at a size, turned and flipped, and where its top left goes from the turning point."""
        key = (round(scale, 4), round(angle, 3), flip)
        if key in self.cache:
            return self.cache[key]
        image = self.scaled(scale)
        cx = self.center_x * scale
        cy = self.center_y * scale
        if flip:
            image = pygame.transform.flip(image, True, False)
            cx = image.get_width() - cx
        # Turn round the middle, then find where the turning point went.
        turned = pygame.transform.rotate(image, -angle) if angle else image
        mx, my = image.get_width() / 2, image.get_height() / 2
        rad = math.radians(angle)
        ox, oy = cx - mx, cy - my
        rx = ox * math.cos(rad) - oy * math.sin(rad)
        ry = ox * math.sin(rad) + oy * math.cos(rad)
        offset = (-(turned.get_width() / 2 + rx), -(turned.get_height() / 2 + ry))
        if len(self.cache) > 200:
            self.cache.clear()
        self.cache[key] = (turned, offset)
        return self.cache[key]


class Sound:
    def __init__(self, spec):
        self.name = spec['name']
        self.file = spec['file']
        rate, count = spec.get('rate', 0), spec.get('sample_count', 0)
        self.duration = count / rate if rate and count else 0.0
        self.sound = None

    def load(self, game):
        if not game.sound_on:
            return
        try:
            self.sound = pygame.mixer.Sound(os.path.join(game.folder, self.file))
            if not self.duration:
                self.duration = self.sound.get_length()
        except (pygame.error, FileNotFoundError) as error:
            print(f'Could not load the sound {self.file}: {error}')

    def play(self, volume, effects):
        if self.sound is None:
            return None
        channel = self.sound.play()
        if channel is not None:
            self.apply(channel, volume, effects)
        return channel

    def apply(self, channel, volume, effects):
        v = clamp(volume / 100, 0, 1)
        pan = clamp(effects.get('pan', 0) / 100, -1, 1)
        channel.set_volume(v * min(1, 1 - pan), v * min(1, 1 + pan))
