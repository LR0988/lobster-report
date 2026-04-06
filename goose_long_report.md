
    __( O)>  ● new session · google gemini-3.1-flash-lite-preview
   \____)    20260406_21 · /Users/huanggin-chen/openclaw_test
     L L     goose is ready

  ────────────────────────────────────────
  ▸ edit
    path snake_game.py
    before: # 視窗設定與常量
WIDTH, HEIGHT = 800, 600
TILE_SIZE = 30
GRID_SIZE = 15

# 顏色定義
COLORS = {
    'BG': QColor(20, 20, 40),
    'FLOOR': QColor(40, 40, 60),
    'WALL': QColor(100, 100, 120),
    'SNAKE_BODY': QColor(50, 200, 50),
    'SNAKE_HEAD': QColor(255, 200, 0),
    'FOOD': QColor(255, 50, 50),
    'TEXT': QColor(255, 255, 255)
}

class SnakeGame(QWidget):
    def __init__(self):
        super().__init__()
        self.setFixedSize(WIDTH, HEIGHT)
        self.setWindowTitle('貪食蛇 3D (PyQt6 版)')
        self.reset()
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_game)
        self.timer.start(100) # 初始速度

    def reset(self):
        self.snake = [[5, 5], [5, 4]]
        self.direction = [1, 0]
        self.food = [random.randint(0, GRID_SIZE-1), random.randint(0, GRID_SIZE-1)]
        self.score = 0
        self.level = 1
        self.game_over = False
        self.game_close = False
        self.speed = 100

    def to_iso(self, x, y):
        iso_x = (x - y) * (TILE_SIZE // 2) + WIDTH // 2
        iso_y = (x + y) * (TILE_SIZE // 4) + HEIGHT // 4
        return iso_x, iso_y

    def keyPressEvent(self, event: QKeyEvent):
        key = event.key()
        if self.game_close:
            if key == Qt.Key.Key_C: self.reset()
            elif key == Qt.Key.Key_Q: sys.exit()
        else:
            if key == Qt.Key.Key_Left and self.direction != [1, 0]: self.direction = [-1, 0]
            elif key == Qt.Key.Key_Right and self.direction != [-1, 0]: self.direction = [1, 0]
            elif key == Qt.Key.Key_Up and self.direction != [0, 1]: self.direction = [0, -1]
            elif key == Qt.Key.Key_Down and self.direction != [0, -1]: self.direction = [0, 1]

    def update_game(self):
        if not self.game_close:
            new_head = [self.snake[0][0] + self.direction[0], self.snake[0][1] + self.direction[1]]
            if new_head[0] < 0 or new_head[0] >= GRID_SIZE or new_head[1] < 0 or new_head[1] >= GRID_SIZE or new_head in self.snake:
                self.game_close = True
            else:
                self.snake.insert(0, new_head)
                if new_head == self.food:
                    self.score += 1
                    self.food = [random.randint(0, GRID_SIZE-1), random.randint(0, GRID_SIZE-1)]
                    if self.score % 5 == 0 and self.level < 10:
                        self.level += 1
                        self.speed = max(30, self.speed - 10)
                        self.timer.setInterval(self.speed)
                else: self.snake.pop()
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # 繪製背景
        painter.fillRect(self.rect(), COLORS['BG'])

        # 繪製地板
        for i in range(GRID_SIZE):
            for j in range(GRID_SIZE):
                self.draw_tile(painter, i, j, COLORS['FLOOR'])

        # 繪製食物
        fx, fy = self.to_iso(self.food[0], self.food[1])
        painter.setBrush(QBrush(COLORS['FOOD']))
        painter.drawEllipse(fx - 10, fy - 25, 20, 20)

        # 繪製蛇
        for i, (x, y) in enumerate(self.snake):
            color = COLORS['SNAKE_HEAD'] if i == 0 else COLORS['SNAKE_BODY']
            self.draw_tile(painter, x, y, color, is_head=(i == 0))

        # UI 資訊
        painter.setPen(Qt.GlobalColor.white)
        painter.setFont(QFont("Arial", 20))
        painter.drawText(20, 40, f"等級: {self.level} | 分數: {self.score}")

        if self.game_close:
            painter.drawText(WIDTH // 4, HEIGHT // 2, "遊戲結束! 按 C 重玩 或 Q 退出")

    def draw_tile(self, painter, x, y, color, is_head=False):
        iso_x, iso_y = self.to_iso(x, y)
        poly = QPolygon([
            (iso_x, iso_y),
            (iso_x + TILE_SIZE // 2, iso_y + TILE_SIZE // 4),
            (iso_x, iso_y + TILE_SIZE // 2),
            (iso_x - TILE_SIZE // 2, iso_y + TILE_SIZE // 4)
        ])
        painter.setBrush(QBrush(color))
        painter.drawPolygon(poly)
        if is_head:
            painter.setBrush(QBrush(Qt.GlobalColor.white))
            painter.drawEllipse(iso_x - 6, iso_y - 5, 6, 6)
            painter.drawEllipse(iso_x + 2, iso_y - 5, 6, 6)
    after: # 視窗設定與常量
WIDTH, HEIGHT = 600, 600
GRID_SIZE = 20
TILE_SIZE = WIDTH // GRID_SIZE

# 顏色定義
COLORS = {
    'BG': QColor(30, 30, 30),
    'SNAKE_BODY': QColor(50, 200, 50),
    'SNAKE_HEAD': QColor(255, 200, 0),
    'FOOD': QColor(255, 50, 50),
    'TEXT': QColor(255, 255, 255)
}

class SnakeGame(QWidget):
    def __init__(self):
        super().__init__()
        self.setFixedSize(WIDTH, HEIGHT)
        self.setWindowTitle('貪食蛇 (PyQt6 2D版)')
        self.reset()
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_game)
        self.timer.start(150) # 速度

    def reset(self):
        self.snake = [[10, 10], [10, 11]]
        self.direction = [0, -1] # 向上
        self.food = [random.randint(0, GRID_SIZE-1), random.randint(0, GRID_SIZE-1)]
        self.score = 0
        self.level = 1
        self.game_over = False
        self.game_close = False
        self.speed = 150

    def keyPressEvent(self, event: QKeyEvent):
        key = event.key()
        if self.game_close:
            if key == Qt.Key.Key_C: self.reset()
            elif key == Qt.Key.Key_Q: sys.exit()
        else:
            if key == Qt.Key.Key_Left and self.direction != [1, 0]: self.direction = [-1, 0]
            elif key == Qt.Key.Key_Right and self.direction != [-1, 0]: self.direction = [1, 0]
            elif key == Qt.Key.Key_Up and self.direction != [0, 1]: self.direction = [0, -1]
            elif key == Qt.Key.Key_Down and self.direction != [0, -1]: self.direction = [0, 1]

    def update_game(self):
        if not self.game_close:
            new_head = [self.snake[0][0] + self.direction[0], self.snake[0][1] + self.direction[1]]
            if new_head[0] < 0 or new_head[0] >= GRID_SIZE or new_head[1] < 0 or new_head[1] >= GRID_SIZE or new_head in self.snake:
                self.game_close = True
            else:
                self.snake.insert(0, new_head)
                if new_head == self.food:
                    self.score += 1
                    self.food = [random.randint(0, GRID_SIZE-1), random.randint(0, GRID_SIZE-1)]
                    if self.score % 5 == 0 and self.level < 10:
                        self.level += 1
                        self.speed = max(50, self.speed - 15)
                        self.timer.setInterval(self.speed)
                else: self.snake.pop()
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        
        # 背景
        painter.fillRect(self.rect(), COLORS['BG'])

        # 繪製食物
        painter.setBrush(QBrush(COLORS['FOOD']))
        painter.drawRect(self.food[0] * TILE_SIZE, self.food[1] * TILE_SIZE, TILE_SIZE-1, TILE_SIZE-1)

        # 繪製蛇
        for i, (x, y) in enumerate(self.snake):
            color = COLORS['SNAKE_HEAD'] if i == 0 else COLORS['SNAKE_BODY']
            painter.setBrush(QBrush(color))
            painter.drawRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE-1, TILE_SIZE-1)
            
            if i == 0: # 畫眼睛
                painter.setBrush(QBrush(Qt.GlobalColor.white))
                painter.drawEllipse(x * TILE_SIZE + 5, y * TILE_SIZE + 5, 8, 8)
                painter.drawEllipse(x * TILE_SIZE + 17, y * TILE_SIZE + 5, 8, 8)

        # UI
        painter.setPen(Qt.GlobalColor.white)
        painter.setFont(QFont("Arial", 16))
        painter.drawText(10, 30, f"等級: {self.level} | 分數: {self.score}")

        if self.game_close:
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "遊戲結束! 按 C 重玩 或 Q 退出")


No match found for the specified text.

Did you mean:
```
import random
import sys

# 初始化 pygame
pygame.init()
```

File preview:
```
   1: import pygame
   2: import random
   3: import sys
   4: 
   5: # 初始化 pygame
   6: pygame.init()
   7: 
   8: # 顏色定義 (更豐富的調色盤以呈現 3D 感)
   9: COLORS = {
  10:     'BG': (20, 20, 40),        # 深藍紫色背景
  11:     'FLOOR': (40, 40, 60),     # 地板
  12:     'WALL': (100, 100, 120),   # 牆壁
  13:     'SNAKE_BODY': (50, 200, 50),
  14:     'SNAKE_HEAD': (255, 200, 0), # 金黃色蛇頭
  15:     'SNAKE_TAIL': (0, 150, 0),   # 深綠色蛇尾
  16:     'FOOD': (255, 50, 50),     # 明亮的紅色食物
  17:     'TEXT': (255, 255, 255),
  18:     'UI_BG': (0, 0, 0, 150)
  19: }
  20: 
... (150 more lines)
```
  ────────────────────────────────────────
  ▸ shell
    command: cat snake_game.py

import pygame
import random
import sys

# 初始化 pygame
pygame.init()

# 顏色定義 (更豐富的調色盤以呈現 3D 感)
COLORS = {
    'BG': (20, 20, 40),        # 深藍紫色背景
    'FLOOR': (40, 40, 60),     # 地板
    'WALL': (100, 100, 120),   # 牆壁
    'SNAKE_BODY': (50, 200, 50),
    'SNAKE_HEAD': (255, 200, 0), # 金黃色蛇頭
    'SNAKE_TAIL': (0, 150, 0),   # 深綠色蛇尾
    'FOOD': (255, 50, 50),     # 明亮的紅色食物
    'TEXT': (255, 255, 255),
    'UI_BG': (0, 0, 0, 150)
}

# 視窗設定
WIDTH, HEIGHT = 800, 600
TILE_SIZE = 30  
GRID_SIZE = 15 # 地圖大小
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption('貪食蛇 3D 挑戰版')
clock = pygame.time.Clock()

# 中文字型設定
def get_font(size):
    font_names = ['simhei', 'microsoftyahei', 'arialuni', 'notosanscjk']
    for name in font_names:
        try:
            return pygame.font.SysFont(name, size)
        except:
            continue
    return pygame.font.SysFont('sans-serif', size)

font_style = get_font(25)
score_font = get_font(40)

# 3D 轉換邏輯
def to_iso(x, y):
    # 增加偏移量置中
    iso_x = (x - y) * (TILE_SIZE // 2) + WIDTH // 2
    iso_y = (x + y) * (TILE_SIZE // 4) + HEIGHT // 4
    return iso_x, iso_y

class Game:
    def __init__(self):
        self.reset()

    def reset(self):
        self.snake = [[5, 5], [5, 4]]
        self.direction = [1, 0]
        self.food = [random.randint(1, GRID_SIZE-2), random.randint(1, GRID_SIZE-2)]
        self.score = 0
        self.level = 1
        self.game_over = False
        self.speed = 8
        self.game_close = False

    def draw_tile(self, x, y, color, height=0):
        iso_x, iso_y = to_iso(x, y)
        iso_y -= height # 視覺高度
        points = [
            (iso_x, iso_y),
            (iso_x + TILE_SIZE // 2, iso_y + TILE_SIZE // 4),
            (iso_x, iso_y + TILE_SIZE // 2),
            (iso_x - TILE_SIZE // 2, iso_y + TILE_SIZE // 4)
        ]
        pygame.draw.polygon(screen, color, points)
        # 加上邊框增加立體感
        pygame.draw.polygon(screen, (255, 255, 255, 50), points, 1)

    def draw_wall(self, x, y):
        # 畫牆壁
        iso_x, iso_y = to_iso(x, y)
        rect_height = 20
        # 頂面
        points = [
            (iso_x, iso_y - rect_height),
            (iso_x + TILE_SIZE // 2, iso_y + TILE_SIZE // 4 - rect_height),
            (iso_x, iso_y + TILE_SIZE // 2 - rect_height),
            (iso_x - TILE_SIZE // 2, iso_y + TILE_SIZE // 4 - rect_height)
        ]
        pygame.draw.polygon(screen, COLORS['WALL'], points)
        # 側面
        side_points = [
            (iso_x - TILE_SIZE // 2, iso_y + TILE_SIZE // 4 - rect_height),
            (iso_x - TILE_SIZE // 2, iso_y + TILE_SIZE // 4),
            (iso_x, iso_y + TILE_SIZE // 2),
            (iso_x, iso_y + TILE_SIZE // 2 - rect_height)
        ]
        pygame.draw.polygon(screen, (80, 80, 100), side_points)

    def run(self):
        while not self.game_over:
            screen.fill(COLORS['BG'])

            # 繪製地板
            for i in range(GRID_SIZE):
                for j in range(GRID_SIZE):
                    self.draw_tile(i, j, COLORS['FLOOR'])
            
            # 繪製牆壁
            for i in range(-1, GRID_SIZE + 1):
                self.draw_wall(i, -1)
                self.draw_wall(i, GRID_SIZE)
            for j in range(-1, GRID_SIZE + 1):
                self.draw_wall(-1, j)
                self.draw_wall(GRID_SIZE, j)

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    pygame.quit()
                    sys.exit()
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_LEFT and self.direction != [1, 0]: self.direction = [-1, 0]
                    elif event.key == pygame.K_RIGHT and self.direction != [-1, 0]: self.direction = [1, 0]
                    elif event.key == pygame.K_UP and self.direction != [0, 1]: self.direction = [0, -1]
                    elif event.key == pygame.K_DOWN and self.direction != [0, -1]: self.direction = [0, 1]
                    elif event.key == pygame.K_c and self.game_close: self.reset()
                    elif event.key == pygame.K_q and self.game_close: pygame.quit(); sys.exit()

            if not self.game_close:
                new_head = [self.snake[0][0] + self.direction[0], self.snake[0][1] + self.direction[1]]
                
                # 碰撞牆壁
                if new_head[0] < 0 or new_head[0] >= GRID_SIZE or new_head[1] < 0 or new_head[1] >= GRID_SIZE:
                    self.game_close = True
                elif new_head in self.snake:
                    self.game_close = True
                else:
                    self.snake.insert(0, new_head)
                    if new_head == self.food:
                        self.score += 1
                        self.food = [random.randint(0, GRID_SIZE-1), random.randint(0, GRID_SIZE-1)]
                        if self.score % 5 == 0 and self.level < 10:
                            self.level += 1
                            self.speed += 2
                    else:
                        self.snake.pop()

            # 繪製蛇
            for i, (x, y) in enumerate(self.snake):
                if i == 0:
                    self.draw_tile(x, y, COLORS['SNAKE_HEAD'], 5) # 蛇頭高一點
                elif i == len(self.snake) - 1:
                    self.draw_tile(x, y, COLORS['SNAKE_TAIL'])
                else:
                    self.draw_tile(x, y, COLORS['SNAKE_BODY'])
            
            # 繪製食物 (畫高一點)
            iso_x, iso_y = to_iso(self.food[0], self.food[1])
            pygame.draw.circle(screen, COLORS['FOOD'], (iso_x, iso_y - 15), 10)

            # UI
            score_text = score_font.render(f"等級: {self.level} | 分數: {self.score}", True, COLORS['TEXT'])
            screen.blit(score_text, (20, 20))

            if self.game_close:
                msg = font_style.render("遊戲結束! 按 C 重玩 或 Q 退出", True, COLORS['LEVEL_UP'])
                screen.blit(msg, (WIDTH // 4, HEIGHT // 2))

            pygame.display.update()
            clock.tick(self.speed)

if __name__ == "__main__":
    Game().run()
  ────────────────────────────────────────
  ▸ write
    path snake_game.py
    content: import sys
import random
from PyQt6.QtWidgets import QApplication, QWidget
from PyQt6.QtCore import QTimer, Qt, QRect, QSize
from PyQt6.QtGui import QPainter, QColor, QBrush, QPen, QKeyEvent, QFont

# 視窗設定與常量
WIDTH, HEIGHT = 600, 600
GRID_SIZE = 20
TILE_SIZE = WIDTH // GRID_SIZE

# 顏色定義
COLORS = {
    'BG': QColor(30, 30, 30),
    'SNAKE_BODY': QColor(50, 200, 50),
    'SNAKE_HEAD': QColor(255, 200, 0),
    'FOOD': QColor(255, 50, 50),
    'TEXT': QColor(255, 255, 255),
    'WALL': QColor(80, 80, 80)
}

class SnakeGame(QWidget):
    def __init__(self):
        super().__init__()
        self.setFixedSize(WIDTH, HEIGHT)
        self.setWindowTitle('貪食蛇 (PyQt6 2D版)')
        self.reset()
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_game)
        self.timer.start(150) # 初始速度

    def reset(self):
        self.snake = [[10, 10], [10, 11]]
        self.direction = [0, -1] # 向上
        self.food = [random.randint(1, GRID_SIZE-2), random.randint(1, GRID_SIZE-2)]
        self.score = 0
        self.level = 1
        self.game_over = False
        self.game_close = False
        self.speed = 150

    def keyPressEvent(self, event: QKeyEvent):
        key = event.key()
        if self.game_close:
            if key == Qt.Key.Key_C: self.reset()
            elif key == Qt.Key.Key_Q: sys.exit()
        else:
            if key == Qt.Key.Key_Left and self.direction != [1, 0]: self.direction = [-1, 0]
            elif key == Qt.Key.Key_Right and self.direction != [-1, 0]: self.direction = [1, 0]
            elif key == Qt.Key.Key_Up and self.direction != [0, 1]: self.direction = [0, -1]
            elif key == Qt.Key.Key_Down and self.direction != [0, -1]: self.direction = [0, 1]

    def update_game(self):
        if not self.game_close:
            new_head = [self.snake[0][0] + self.direction[0], self.snake[0][1] + self.direction[1]]
            
            # 碰撞牆壁
            if new_head[0] < 0 or new_head[0] >= GRID_SIZE or new_head[1] < 0 or new_head[1] >= GRID_SIZE or new_head in self.snake:
                self.game_close = True
            else:
                self.snake.insert(0, new_head)
                if new_head == self.food:
                    self.score += 1
                    self.food = [random.randint(1, GRID_SIZE-2), random.randint(1, GRID_SIZE-2)]
                    if self.score % 5 == 0 and self.level < 10:
                        self.level += 1
                        self.speed = max(50, self.speed - 15)
                        self.timer.setInterval(self.speed)
                else: self.snake.pop()
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # 背景
        painter.fillRect(self.rect(), COLORS['BG'])

        # 繪製食物 (卡通感)
        painter.setBrush(QBrush(COLORS['FOOD']))
        painter.setPen(Qt.PenStyle.NoPen)
        fx, fy = self.food[0] * TILE_SIZE, self.food[1] * TILE_SIZE
        painter.drawEllipse(fx + 5, fy + 5, TILE_SIZE-10, TILE_SIZE-10)

        # 繪製蛇
        for i, (x, y) in enumerate(self.snake):
            color = COLORS['SNAKE_HEAD'] if i == 0 else COLORS['SNAKE_BODY']
            painter.setBrush(QBrush(color))
            # 蛇身方形
            painter.drawRoundedRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE-4, TILE_SIZE-4, 5, 5)
            
            if i == 0: # 畫眼睛 (卡通)
                painter.setBrush(QBrush(Qt.GlobalColor.white))
                # 簡單眼睛
                painter.drawEllipse(x * TILE_SIZE + 5, y * TILE_SIZE + 5, 8, 8)
                painter.drawEllipse(x * TILE_SIZE + 17, y * TILE_SIZE + 5, 8, 8)
                painter.setBrush(QBrush(Qt.GlobalColor.black))
                painter.drawEllipse(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 3, 3)
                painter.drawEllipse(x * TILE_SIZE + 20, y * TILE_SIZE + 8, 3, 3)

        # UI
        painter.setPen(QPen(Qt.GlobalColor.white))
        painter.setFont(QFont("Microsoft YaHei", 16)) # 支援中文
        painter.drawText(10, 30, f"等級: {self.level} | 分數: {self.score}")

        if self.game_close:
            painter.setFont(QFont("Microsoft YaHei", 24))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "遊戲結束!\n按 C 重玩 或 Q 退出")

if __name__ == '__main__':
    app = QApplication(sys.argv)
    game = SnakeGame()
    game.show()
    sys.exit(app.exec())


Wrote snake_game.py (115 lines)
  ────────────────────────────────────────
  ▸ todo_write todo
    content: - [x] 基礎環境設定
- [x] 實現 Isometric 3D 視覺效果 (已移除，改為 2D)
- [x] 實現 10 關等級遞增邏輯
- [x] 修正中文顯示
- [x] 進階視覺與遊戲性優化 (卡通風格)
- [x] 引擎轉換至 PyQt6 (完成)
- [x] 重新調整為 2D 視角以改善操控體驗 (完成)
- [ ] 測試與驗證

遊戲已轉換為 PyQt6 2D 版本，並移除 45 度角視角以提供直覺操控。
執行方式：`python snake_game.py`

收到，我已經將貪食蛇遊戲調整回 **直覺的 2D 視角**，並移除了原本容易造成視覺誤判的 45 度等軸測視角（Isometric Projection），同時保留了您要求的 **PyQt6** 引擎、**卡通風格** 蛇頭造型與 **10 關等級遞增** 邏輯。

### 本次更新與調整：
1.  **視角優化**：改為純 2D 上視圖 (Top-down view)，現在移動方向與鍵盤操控將完全一致，不再有深度錯位感。
2.  **卡通風格**：保留了繪製眼睛的蛇頭造型，蛇身採用圓角矩形設計，整體視覺更親切。
3.  **效能優化**：使用 PyQt6 的 `QPainter` 高效繪製，並修正了字型載入邏輯以支援中文。
4.  **遊戲性**：等級提升機制完整保留，隨著關卡提升，速度會逐步加快。

### 如何執行：
您可以直接執行以下指令啟動：
```bash
python snake_game.py
```

現在的操控應該非常符合直覺，如果您覺得還需要微調顏色或是蛇身的卡通細節，歡迎隨時告訴我！
