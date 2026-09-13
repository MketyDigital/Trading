import unittest

from listener import build_telegram_event


class NestedReplyHeader:
    forum_topic = False
    reply_to_top_id = None

    def __init__(self, reply_to_msg_id):
        self.reply_to_msg_id = reply_to_msg_id


class Message:
    media = None
    edit_date = None

    def __init__(self, reply_to_msg_id):
        self.reply_to_msg_id = None
        self.reply_to = NestedReplyHeader(reply_to_msg_id)


class Event:
    chat_id = -1003902892609
    id = 241
    raw_text = 'close'
    out = False
    edit_date = None
    reply_to_msg_id = None

    def __init__(self):
        self.message = Message(238)
        self.reply_to = None


class ReplyContractTests(unittest.TestCase):
    def test_nested_message_reply_header_is_canonicalized(self):
        payload = build_telegram_event(Event(), now_iso=lambda: '2026-09-13T20:00:00Z')
        self.assertEqual(payload['thread']['reply_to_event_id'], 'telegram:-1003902892609:238')


if __name__ == '__main__':
    unittest.main()
