gitimport os
import re
import openpyxl
import logging

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

# Define the regex patterns to identify potential SQL injection vulnerabilities
patterns = {
    "String Concatenation": re.compile(r"\".*\"\s*\+\s*.*\s*\+\s*\".*\""),
    "Direct Query": re.compile(r"(Statement|Connection|executeQuery|executeUpdate)\s*\(\s*\".*\""),
    "User Input in Query": re.compile(r"\".*\"\s*\+\s*\w+\s*\+\s*\".*\"")
}

def find_sql_injections_in_file(file_path, sheet):
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()
            for line_number, line in enumerate(lines, start=1):
                for pattern_name, pattern in patterns.items():
                    if pattern.search(line):
                        sheet.append([file_path, line_number, line.strip(), pattern_name])
                        logging.debug(f"Match found in {file_path} at line {line_number}: {line.strip()}")
    except Exception as e:
        logging.error(f"Error reading file {file_path}: {e}")

def traverse_and_scan(path, output_file):
    try:
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "SQL Injections"
        sheet.append(["File Path", "Line Number", "Code Snippet", "Regex Type"])

        if os.path.isfile(path):
            logging.debug(f"Scanning file: {path}")
            if path.endswith(".java"):
                find_sql_injections_in_file(path, sheet)
        elif os.path.isdir(path):
            logging.debug(f"Scanning directory: {path}")
            for root, _, files in os.walk(path):
                for file in files:
                    if file.endswith(".java"):
                        file_path = os.path.join(root, file)
                        find_sql_injections_in_file(file_path, sheet)

        workbook.save(output_file)
        logging.info(f"Results saved to {output_file}")
    except Exception as e:
        logging.error(f"Error during scanning: {e}")

if __name__ == "__main__":
    try:
        path_to_scan = input("Enter the file or directory to scan for SQL injection vulnerabilities: ")
        output_file = "sql_injection_report.xlsx"
        traverse_and_scan(path_to_scan, output_file)
    except Exception as e:
        logging.error(f"Error in main execution: {e}")
