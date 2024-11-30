import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import pandas as pd

# Function to read log file and convert to DataFrame
def read_log_file(file_path):
    data = []
    with open(file_path, 'r') as file:
        for line in file:
            key, value = line.strip().split(':')
            data.append((key, value))
    df = pd.DataFrame(data, columns=['Key', 'Value'])
    return df

# Function to send email
def send_email(subject, body, to_email, from_email, smtp_server, smtp_port, smtp_user, smtp_password):
    msg = MIMEMultipart()
    msg['From'] = 
    msg['To'] = 
    msg['Subject'] = subject

    msg.attach(MIMEText(body, 'html'))

    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(from_email, to_email, msg.as_string())

# Main function
def main():
    log_file_path = 'C:\Users\Lenovo\OneDrive\Documents\Pythonn.log'
    df = read_log_file(log_file_path)

    # Convert DataFrame to HTML table
    html_table = df.to_html(index=False)

    # Email details
    subject = 'Log File Report'
    body = f'<h2>Log File Report</h2>{html_table}'
    to_email = 'recipient@example.com'
    from_email = 'your_email@example.com'
    smtp_server = 'smtp.example.com'
    smtp_port = 587
    smtp_user = 'your_email@example.com'
    smtp_password = 'your_password'

    send_email(subject, body, to_email, from_email, smtp_server, smtp_port, smtp_user, smtp_password)

if __name__ == '__main__':
    main()
