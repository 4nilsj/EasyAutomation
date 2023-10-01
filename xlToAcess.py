import pandas as pd
import pyodbc

# Define the Excel file path and Access database file path
excel_file = input("Enter the path for the excel file to upload to Access DB: ")
access_db_file = input("Enter the path for the AceessDB file: ")

# Establish a connection to the Access database
conn = pyodbc.connect(r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=' + access_db_file)
cursor = conn.cursor()

# Read data from the Excel file
df = pd.read_excel(excel_file)

# Loop through the rows of the DataFrame and insert data into the Access database
for index, row in df.iterrows():
    # Assuming the columns in the Excel file correspond to columns in the Access table
    # Modify the SQL query and table name as per your database schema
    sql_query = "INSERT INTO User (Username, Password) VALUES ( ?, ?)"  # Replace with your table and column names
    values = ( row['User'], row['Pass'])  # Replace with your Excel column names

    cursor.execute(sql_query, values)
    conn.commit()

# Close the database connection
conn.close()

print("Data from Excel file has been successfully inserted into the Access database.")
