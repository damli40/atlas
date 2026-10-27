# Raises Python's own PermissionError for a rule of its own (no file or network is touched).
def check_role(role):
    if role != "admin":
        raise PermissionError(f"role {role} may not delete")
    return "deleted"
