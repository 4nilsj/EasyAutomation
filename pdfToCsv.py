import tabula
import pandas as pd

# Define the PDF file path
pdf_file = input("Enter the path to the PDF file: ")

# Define the output Excel file path
excel_file = input("Enter the path for the output CSV file: ")

# Extract tables from the PDF and save them as a list of DataFrames
tables = tabula.read_pdf(pdf_file, pages='all', multiple_tables=True)

# Combine the list of DataFrames into one DataFrame (if there are multiple tables)
combined_df = pd.concat(tables, ignore_index=True)

# Export the combined DataFrame to an Excel file
combined_df.to_excel(excel_file, index=False)

print(f'Data from {pdf_file} has been converted to {excel_file}')
