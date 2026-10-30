"""Prevent a Tkinter callback from being referenced before its definition."""
import ast
import unittest
from pathlib import Path

MANAGER = Path(__file__).with_name("manager_ui.py")

class ManagerStartupOrderTests(unittest.TestCase):
    def test_remove_profile_callback_bound_before_action_rows(self):
        module = ast.parse(MANAGER.read_text(encoding="utf-8"))
        run = next(node for node in module.body if isinstance(node, (ast.FunctionDef,ast.AsyncFunctionDef)) and node.name == "run_manager")
        defined = next(node.lineno for node in run.body if isinstance(node, ast.FunctionDef) and node.name == "remove_selected_profile")
        row = next(node for node in run.body if isinstance(node, ast.Assign) and any(isinstance(target,ast.Name) and target.id=="action_rows" for target in node.targets))
        used = [node.lineno for node in ast.walk(row.value) if isinstance(node,ast.Name) and node.id=="remove_selected_profile" and isinstance(node.ctx,ast.Load)]
        self.assertTrue(used, "Remove action callback must be wired")
        self.assertLess(defined,min(used), "Remove callback must be defined before construction of action rows")

if __name__ == "__main__":
    unittest.main()
