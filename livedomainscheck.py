import requests
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed

# Function to check if a domain is live
def check_domain(domain):
    status = {}
    for protocol in ['http', 'https']:
        try:
            response = requests.get(f"{protocol}://{domain}", timeout=5)
            status[protocol] = {
                'status_code': response.status_code,
                'is_live': response.status_code == 200
            }
        except requests.exceptions.RequestException:
            status[protocol] = {
                'status_code': 'N/A',
                'is_live': False
            }
    return domain, status

# Read domain names from a text file
with open('testdomains.txt', 'r') as file:
    domains = file.read().splitlines()

# Check each domain using multithreading
results = []
with ThreadPoolExecutor(max_workers=10) as executor:
    future_to_domain = {executor.submit(check_domain, domain): domain for domain in domains}
    for future in as_completed(future_to_domain):
        domain, status = future.result()
        results.append({
            'Domain': domain,
            'HTTP Status Code': status['http']['status_code'],
            'HTTPS Status Code': status['https']['status_code'],
            'HTTP Live': 'Yes' if status['http']['is_live'] else 'No',
            'HTTPS Live': 'Yes' if status['https']['is_live'] else 'No'
        })

# Create a DataFrame from the results
df = pd.DataFrame(results)

# Convert the DataFrame to an HTML file
html_output = df.to_html(index=False)

with open('domain_status.html', 'w') as file:
    file.write(html_output)

print("The results have been saved to 'domain_status.html'.")
