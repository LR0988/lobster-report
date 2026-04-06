import sys
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
