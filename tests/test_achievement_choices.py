import unittest

from server import validate_achievement_choice


class AchievementChoicesTest(unittest.TestCase):
    def test_gto_accepts_only_badges(self):
        for value in ("Золотой знак", "Серебряный знак", "Бронзовый знак"):
            validate_achievement_choice({"category": "ВФСК «ГТО»", "distinction": value})
        for value in ("", "Мастер спорта", "Первый разряд"):
            with self.assertRaises(ValueError):
                validate_achievement_choice({"category": "ВФСК «ГТО»", "distinction": value})

    def test_rank_rejects_gto_badges(self):
        validate_achievement_choice({"category": "Спортивное звание (разряд)", "distinction": "Первый разряд"})
        with self.assertRaises(ValueError):
            validate_achievement_choice({"category": "Спортивное звание (разряд)", "distinction": "Золотой знак"})

    def test_other_categories_need_no_distinction(self):
        validate_achievement_choice({"category": "Спортивное мероприятие"})


if __name__ == '__main__':
    unittest.main()
